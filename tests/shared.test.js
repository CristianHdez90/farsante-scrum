'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {RedisStore}=require('../lib/redis-store');
const {createSharedEndpoint}=require('../lib/shared-api');
const {json}=require('../lib/http');
const {ROOMS}=require('../lib/game');
const {createRedisFixture}=require('./redis-fixture');
let fixture,bases,servers,stores;
test.before(async()=>{
  fixture=createRedisFixture();
  await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${fixture.server.address().port}`;
  stores=[0,1].map(()=>new RedisStore({url,token:'test-token',prefix:'test'}));
  servers=stores.map(store=>{
    const endpoint=createSharedEndpoint(store);
    return http.createServer(async(req,res)=>{
      try{const u=new URL(req.url,'http://localhost');await endpoint(req,res,u.pathname,u.searchParams);}
      catch(e){json(res,e.status||500,{error:e.message});}
    });
  });
  bases=[];
  for(const server of servers){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));bases.push(`http://127.0.0.1:${server.address().port}`);}
});
test.after(async()=>{
  for(const server of [...servers,fixture.server]){
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
async function post(instance,path,body){
  const r=await fetch(bases[instance]+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error}`);return data;
}
async function get(auth,instance=0){
  const r=await fetch(`${bases[instance]}/api/state?room=${auth.room}&token=${auth.token}`);
  const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error}`);return data;
}
const act=(auth,type,more={},instance=0)=>post(instance,'/api/action',{...auth,type,...more});
async function room3(){
  const host=await post(0,'/api/create',{name:'Host'});
  const others=await Promise.all(['QA','Dev'].map((name,i)=>post(i,'/api/join',{room:host.room,name})));
  return [host,...others];
}
async function expire(auth,ms){
  await stores[0].update(auth.room,room=>{room.deadline=Date.now()-ms;});
}
test('Dos instancias comparten salas, entradas y votos concurrentes sin perder actualizaciones',async()=>{
  const auths=await room3(),host=auths[0];
  assert.equal(ROOMS.size,0);
  assert.equal((await get(host,1)).players.length,3);
  assert.equal((await get(host,1)).transport,'poll');
  await assert.rejects(act(auths[1],'start'),/Solo el anfitrión/);
  await act(host,'start',{},1);
  const roles=await Promise.all(auths.map((auth,i)=>get(auth,i%2)));
  const imp=roles.find(s=>s.me.role==='impostor');
  assert.equal(roles.filter(s=>s.me.role==='impostor').length,1);
  assert.equal(imp.me.word,null);
  assert.ok(roles.every(s=>!s.reveal));
  await Promise.all(auths.map((auth,i)=>act(auth,'ready',{},i%2)));
  assert.equal((await get(host)).stage,'clues');
  for(let i=0;i<3;i++)await act(host,'skip',{},i%2);
  await act(host,'voting',{},1);
  assert.deepEqual((await get(host)).votingResults,[]);
  const normal=roles.find(s=>s.me.role==='normal');
  await Promise.all(auths.map((auth,i)=>act(auth,'vote',{targetId:auth.playerId===imp.me.id?normal.me.id:imp.me.id},i%2)));
  const outcome=await get(host,1);
  assert.equal(outcome.stage,'guess');
  assert.equal(outcome.voteCount,3);
  assert.equal(outcome.lastRemoved.id,imp.me.id);
  assert.equal(outcome.votingResults[0].votes,2);
  await act(auths.find(a=>a.playerId===imp.me.id),'guess',{guess:normal.me.word},1);
  assert.equal((await get(host)).winner,'impostor');
  await act(host,'reset');
  assert.equal((await get(host,1)).stage,'lobby');
});
test('Vencimientos persistidos avanzan fases desde otra instancia sin timers activos',async()=>{
  const auths=await room3(),host=auths[0];
  await act(host,'start');
  // Roles -> three expired turns -> discussion, using original deadlines.
  await expire(host,3*60000+1000);
  const s=await get(host,1);
  assert.equal(s.stage,'discussion');
  assert.equal(s.clues.length,3);
  assert.ok(s.deadline>Date.now());
  await expire(host,1);
  assert.equal((await get(host)).stage,'vote');
  await act(host,'vote',{targetId:auths[1].playerId});
  await expire(host,1);
  const result=await get(host,1);
  assert.equal(result.stage,'reveal');
  assert.equal(result.outcome,'quorum');
  assert.equal(result.votingResults.find(p=>p.id===auths[1].playerId).votes,1);
  assert.equal(result.lastRemoved,null);
});
test('Presencia compartida, errores de sesión y eliminación de salas vacías',async()=>{
  const auths=await room3(),host=auths[0];
  await stores[0].update(host.room,room=>{room.players[1].lastSeen=Date.now()-31000;});
  await assert.rejects(act(host,'start'),/conectados/);
  await get(auths[1],1);
  await assert.rejects(get({...host,token:'invalid'}),/403/);
  for(const auth of auths)await act(auth,'leave',{},1);
  await assert.rejects(get(host),/404/);
});
test('Credenciales faltantes y fallos de Redis no revelan secretos ni usan memoria como respaldo',async()=>{
  const store=new RedisStore({});
  await assert.rejects(store.command(['GET','x']),e=>e.status===503);
  const broken=new RedisStore({url:'https://example.invalid',token:'secret-token',fetchImpl:async()=>{throw new Error('secret-token');}});
  await assert.rejects(broken.command(['GET','x']),e=>e.status===503&&!e.message.includes('secret-token'));
});

test('Entrada Vercel acepta cuerpos preprocesados y rutas reescritas; health comprueba Redis',async()=>{
  const envKeys=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','REDIS_KEY_PREFIX'];
  const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
  const handler=require('../api/index');
  async function invoke(req){
    let status,body;
    await handler(req,{writeHead(code){status=code;},end(value){body=JSON.parse(value);}});
    return {status,body};
  }
  try{
    process.env.UPSTASH_REDIS_REST_URL=stores[0].url;
    process.env.UPSTASH_REDIS_REST_TOKEN='test-token';
    process.env.REDIS_KEY_PREFIX='vercel-entry';
    assert.deepEqual(await invoke({url:'/api/index?endpoint=health',method:'GET'}),{status:200,body:{status:'ok'}});
    const created=await invoke({url:'/api/index?endpoint=create',method:'POST',body:{name:'Vercel Host'}});
    assert.equal(created.status,201);
    const {room,token}=created.body;
    const state=await invoke({url:`/api/index?room=${room}&token=${token}`,query:{endpoint:'state'},method:'GET'});
    assert.equal(state.status,200);
    assert.equal(state.body.me.name,'Vercel Host');
    assert.equal(state.body.transport,'poll');
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.equal((await invoke({url:'/api/index?endpoint=health',method:'GET'})).status,503);
  }finally{
    for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
});
