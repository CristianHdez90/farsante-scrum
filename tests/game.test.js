'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const {server,ROOMS} = require('../server.js');
let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{for (const room of ROOMS.values())if(room.timer)clearTimeout(room.timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const post=async (endpoint,body)=>{
  const r=await fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error}`);return data;
};
const get=async auth=>{
  const r=await fetch(`${base}/api/state?room=${auth.room}&token=${auth.token}`);
  assert.equal(r.status,200);return r.json();
};
const act=(auth,type,more={})=>post('/api/action',{...auth,type,...more});
async function connectEvents(auth){
  return new Promise((resolve,reject)=>{
    const req=http.get(`${base}/api/events?room=${auth.room}&token=${auth.token}`,res=>{res.on('data',()=>{});resolve({req,res});});
    req.on('error',reject);
  });
}
async function room3(){
  const a=await post('/api/create',{name:'Host',words:['Scrum','Sprint','Daily','HA']});
  const b=await post('/api/join',{room:a.room,name:'QA'});
  const c=await post('/api/join',{room:a.room,name:'Dev'});
  const auths=[a,b,c],streams=[];
  for(const auth of auths)streams.push(await connectEvents(auth));
  return {auths,streams};
}
function closeStreams(streams){for(const {req,res} of streams){res.destroy();req.destroy();}}
async function readyAll(auths){
  const pre=await get(auths[0]);
  assert.equal(pre.stage,'roles');
  assert.equal(pre.readyCount,0);
  await Promise.all(auths.map(a=>act(a,'ready')));
  const post=await get(auths[0]);
  assert.equal(post.stage,'clues');
}
async function feedClues(auths){
  const first=await get(auths[0]);
  const lookup=new Map();
  for(const auth of auths){const st=await get(auth);lookup.set(st.me.id,auth);}
  for(let i=0;i<first.order.length;i++)await act(lookup.get(first.order[i]),'clue',{clue:`pista${i+1}`});
  assert.equal((await get(auths[0])).stage,'discussion');
  await act(auths[0],'voting');
  assert.equal((await get(auths[0])).stage,'vote');
  return lookup;
}
test('Sala, cartas secretas, orden automático, votos y adivinanza correcta',async()=>{
  const {auths,streams}=await room3();
  try {
    const lobby=await get(auths[0]);
    assert.equal(lobby.stage,'lobby');assert.equal(lobby.players.length,3);
    await act(auths[0],'start');
    // El farsante no recibe la palabra ni siquiera durante la preparación.
    const waiting=await Promise.all(auths.map(get));
    assert.equal(waiting.filter(s=>s.me.word===null).length,1);
    await readyAll(auths);
    const states=await Promise.all(auths.map(get));
    assert.equal(states[0].stage,'clues');
    assert.equal(new Set(states[0].order).size,3);
    const impostors=states.filter(s=>s.me.role==='impostor');
    const normals=states.filter(s=>s.me.role==='normal');
    assert.equal(impostors.length,1);
    assert.equal(normals.length,2);
    assert.equal(impostors[0].me.word,null);
    assert.ok(['Scrum','Sprint','Daily','HA'].includes(normals[0].me.word));
    assert.equal(normals[0].me.word,normals[1].me.word);
    assert.equal(states[0].reveal,undefined);
    await feedClues(auths);
    const impId=impostors[0].me.id;
    const normalId=normals[0].me.id;
    for(const auth of auths){const s=await get(auth);await act(auth,'vote',{targetId:s.me.id===impId?normalId:impId});}
    const after=await get(auths[0]);
    assert.equal(after.stage,'guess');
    assert.equal(after.lastRemoved.wasImpostor,true);
    assert.equal(after.lastRemoved.id,impId);
    for(const auth of auths){
      const result=await get(auth);
      assert.deepEqual(result.lastRemoved,after.lastRemoved);
      assert.deepEqual(result.votingResults,after.votingResults);
    }
    assert.equal(after.votingResults[0].votes,2);
    await act(auths.find(a=>a.playerId===impId),'guess',{guess:normals[0].me.word});
    const final=await get(auths[0]);assert.equal(final.stage,'finished');assert.equal(final.winner,'impostor');
    assert.equal(final.reveal.word,normals[0].me.word);
    await act(auths[0],'reset');
    assert.equal((await get(auths[0])).stage,'lobby');
  }finally{closeStreams(streams);}
});
test('Votar por un inocente termina la partida y revela al verdadero impostor',async()=>{
  const {auths,streams}=await room3();
  try {
    await act(auths[0],'start');
    await readyAll(auths);
    const states=await Promise.all(auths.map(get));
    const imp=states.find(s=>s.me.role==='impostor');
    const normals=states.filter(s=>s.me.role==='normal');
    await feedClues(auths);
    // Two votes on innocent, one on the impostor -> game ends with two players (impostor wins).
    for (const auth of auths){const s=await get(auth);await act(auth,'vote',{targetId:s.me.id===normals[0].me.id?imp.me.id:normals[0].me.id});}
    const after=await get(auths[0]);
    assert.equal(after.stage,'finished');assert.equal(after.winner,'impostor');
    assert.equal(after.lastRemoved.wasImpostor,false);
    assert.equal(after.lastRemoved.name,normals[0].me.name);
    assert.equal(after.reveal.impostor,imp.me.name);
  }finally{closeStreams(streams);}
});
test('Validaciones: entrada, turno incorrecto, votos duplicados y palabras insuficientes',async()=>{
  const {auths,streams}=await room3();
  try {
    await assert.rejects(act(auths[0],'words',{words:['Scrum']}),/al menos 3/);
    await act(auths[0],'start');
    await readyAll(auths);
    const state=await get(auths[0]);
    const notTurn=auths.find(a=>a.playerId!==state.turnPlayerId);
    await assert.rejects(act(notTurn,'clue',{clue:'hola'}),/no es tu turno/i);
    const turn=auths.find(a=>a.playerId===state.turnPlayerId);
    const turnState=await get(turn);
    if(turnState.me.word)await assert.rejects(act(turn,'clue',{clue:turnState.me.word}),/palabra secreta/i);
    await feedClues(auths);
    const voter=auths[0];
    await assert.rejects(act(voter,'vote',{targetId:voter.playerId}),/otro participante/i);
    await act(voter,'vote',{targetId:auths[1].playerId});
    await assert.rejects(act(voter,'vote',{targetId:auths[2].playerId}),/Ya has votado/);
  }finally{closeStreams(streams);}
});
test('Cuatro jugadores: empate no elimina a nadie y siguiente ronda',async()=>{
  const {auths,streams}=await room3();
  try{
    const d=await post('/api/join',{room:auths[0].room,name:'PO'});
    auths.push(d);streams.push(await connectEvents(d));
    await act(auths[0],'start');
    await readyAll(auths);
    const who=await Promise.all(auths.map(get));
    const imp=who.find(s=>s.me.role==='impostor');
    const normals=who.filter(s=>s.me.role==='normal');
    await feedClues(auths);
    // A y B reciben exactamente dos votos cada uno; nadie se vota a sí mismo.
    const A=normals[0].me.id, B=normals[1].me.id;
    const third=normals[2].me.id;
    const targetForOwn=new Map([[A,B],[B,A],[imp.me.id,A],[third,B]]);
    for(const auth of auths){
      const own=(await get(auth)).me.id;
      await act(auth,'vote',{targetId:targetForOwn.get(own)});
    }
    const after=await get(auths[0]);
    assert.equal(after.stage,'reveal');assert.equal(after.outcome,'tie');
    assert.equal(after.lastRemoved,null);
    await act(auths[0],'next');
    const next=await get(auths[0]);
    assert.equal(next.stage,'clues');assert.equal(next.round,2);
    assert.equal(next.players.filter(p=>!p.eliminated).length,4);
  }finally{closeStreams(streams);}
});
test('Cuatro jugadores: el inocente más votado termina la partida y todos ven al verdadero impostor',async()=>{
  const {auths,streams}=await room3();
  try{
    const d=await post('/api/join',{room:auths[0].room,name:'PO'});
    auths.push(d);streams.push(await connectEvents(d));
    await act(auths[0],'start');
    await readyAll(auths);
    const who=await Promise.all(auths.map(get));
    const imp=who.find(s=>s.me.role==='impostor');
    const innocent=who.find(s=>s.me.role==='normal');
    await feedClues(auths);
    for(const auth of auths){
      const own=(await get(auth)).me.id;
      await act(auth,'vote',{targetId:own===innocent.me.id?imp.me.id:innocent.me.id});
    }
    const after=await get(auths[0]);
    assert.equal(after.stage,'finished');assert.equal(after.outcome,'innocent');
    assert.equal(after.lastRemoved.id,innocent.me.id);
    assert.equal(after.lastRemoved.wasImpostor,false);
    assert.equal(after.winner,'impostor');
    assert.equal(after.deadline,null);
    assert.equal(after.votingResults[0].votes,3);
    for(const auth of auths){
      const result=await get(auth);
      assert.equal(result.reveal.impostor,imp.me.name);
      assert.equal(result.reveal.word,innocent.me.word);
      assert.ok(result.reveal.reflection);
    }
    await assert.rejects(act(auths[0],'next'),/No se puede iniciar/);
    await act(auths[0],'reset');
    assert.equal((await get(auths[0])).stage,'lobby');
  }finally{closeStreams(streams);}
});
test('El anfitrión puede salir del lobby y ceder el control',async()=>{
  const {auths,streams}=await room3();
  try{
    await act(auths[0],'leave');
    const newHost=await get(auths[1]);
    assert.equal(newHost.isHost,true);
    assert.equal(newHost.players.length,2);
    await act(auths[1],'words',{words:['Scrum','Sprint','Daily']});
    assert.equal((await get(auths[1])).wordCount,3);
  }finally{closeStreams(streams);}
});

test('Fase de preparación: nadie comienza antes de recibir las confirmaciones',async()=>{
  const {auths,streams}=await room3();
  try{
    await act(auths[0],'start');
    const before=await get(auths[0]);
    assert.equal(before.stage,'roles');
    await assert.rejects(act(auths[0],'clue',{clue:'calidad'}),/no es tu turno/);
    await act(auths[0],'ready');
    await act(auths[1],'ready');
    assert.equal((await get(auths[0])).stage,'roles');
    assert.equal((await get(auths[0])).readyCount,2);
    assert.equal((await get(auths[1])).readySubmitted,true);
    await act(auths[2],'ready');
    assert.equal((await get(auths[0])).stage,'clues');
  }finally{closeStreams(streams);}
});

test('Solo el anfitrión puede comenzar, saltar turnos, abrir o cerrar votaciones',async()=>{
  const {auths,streams}=await room3();
  try{
    await assert.rejects(act(auths[1],'start'),/Solo el anfitrión/);
    await act(auths[0],'start');
    await readyAll(auths);
    await assert.rejects(act(auths[1],'skip'),/Solo el anfitrión/);
    const st=await get(auths[0]);
    assert.equal(st.order.length,3);
    await act(auths[0],'skip');
    const next=await get(auths[0]);
    assert.equal(next.turnIndex,1);
    assert.equal(next.clues[0].clue,'Sin pista');
    assert.equal(next.clues[0].skipped,true);
    const lookup=new Map(auths.map(a=>[a.playerId,a]));
    await act(lookup.get(next.turnPlayerId),'clue',{clue:'otra'});
    await act(auths[0],'skip');
    await assert.rejects(act(auths[1],'voting'),/Solo el anfitrión/);
    await act(auths[0],'voting');
    await assert.rejects(act(auths[1],'closeVote'),/Solo el anfitrión/);
    await assert.rejects(act(auths[0],'closeVote'),/dos tercios/);
    assert.equal((await get(auths[0])).stage,'vote');
  }finally{closeStreams(streams);}
});

test('Cerrar anticipadamente con dos tercios: se mantiene el cuórum y no se filtran votos individuales',async()=>{
  const {auths,streams}=await room3();
  try{
    await act(auths[0],'start');
    await readyAll(auths);
    const states=await Promise.all(auths.map(get));
    const imp=states.find(s=>s.me.role==='impostor');
    const normals=states.filter(s=>s.me.role==='normal');
    await feedClues(auths);
    const room=ROOMS.get(auths[0].room);
    assert.equal(room.eligibleVoterIds.length,3);
    await act(auths.find(a=>a.playerId===normals[0].me.id),'vote',{targetId:imp.me.id});
    assert.equal((await get(auths[1])).voteCount,1);
    assert.deepEqual((await get(auths[1])).votingResults,[]);
    await act(auths.find(a=>a.playerId===normals[1].me.id),'vote',{targetId:imp.me.id});
    assert.equal((await get(auths[0])).expectedVotes,3);
    await act(auths[0],'closeVote');
    assert.equal((await get(auths[0])).stage,'guess');
    await assert.rejects(act(auths.find(a=>a.playerId===normals[0].me.id),'guess',{guess:'Scrum'}),/solo para el impostor/);
    await act(auths.find(a=>a.playerId===imp.me.id),'guess',{guess:'ZZZ-muy-improbable'});
    assert.equal((await get(auths[0])).winner,'equipo');
  }finally{closeStreams(streams);}
});

test('Una desconexión no cambia el total de votantes exigidos',async()=>{
  const {auths,streams}=await room3();
  try{
    await act(auths[0],'start');
    await readyAll(auths);
    await feedClues(auths);
    const before=await get(auths[0]);
    assert.equal(before.expectedVotes,3);
    const stream=streams.pop();
    closeStreams([stream]);
    await new Promise(resolve=>setTimeout(resolve,20));
    const after=await get(auths[0]);
    assert.equal(after.expectedVotes,3);
  }finally{closeStreams(streams);}
});

test('Sala de doce jugadores: exactamente un farsante, sin revelar palabra a ese jugador',async()=>{
  const host=await post('/api/create',{name:'Anfitrion',words:['Scrum','Sprint','Daily']});
  const auths=[host],streams=[];
  try{
    for(let n=1;n<12;n++)auths.push(await post('/api/join',{room:host.room,name:`Persona ${n}`}));
    for(const auth of auths)streams.push(await connectEvents(auth));
    await act(host,'start');
    const states=await Promise.all(auths.map(get));
    assert.equal(states.filter(s=>s.me.role==='impostor').length,1);
    assert.equal(states.filter(s=>s.me.role==='normal').length,11);
    assert.equal(states.find(s=>s.me.role==='impostor').me.word,null);
    const normalWords=new Set(states.filter(s=>s.me.role==='normal').map(s=>s.me.word));
    assert.equal(normalWords.size,1);
    await assert.rejects(post('/api/join',{room:host.room,name:'Persona 13'}),/partida ya comenzó/);
  }finally{closeStreams(streams);}
});

test('Salud y sesión: health responde y un token inválido no permite ver roles',async()=>{
  const response=await fetch(base+'/health');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok'});
  const host=await post('/api/create',{name:'Anfitrion',words:['Scrum','Daily','Sprint']});
  const bad=await fetch(`${base}/api/state?room=${host.room}&token=invalido`);
  assert.equal(bad.status,403);
  assert.equal((await get(host)).me.role,null);
});

test('Inicio exige tres participantes conectados y no permite reasignar roles al iniciar dos veces',async()=>{
  const host=await post('/api/create',{name:'Anfitrion'});
  await assert.rejects(act(host,'start'),/al menos 3/);
  const b=await post('/api/join',{room:host.room,name:'QA'});
  const c=await post('/api/join',{room:host.room,name:'Dev'});
  const streams=[];
  try {
    streams.push(await connectEvents(host),await connectEvents(b));
    await assert.rejects(act(host,'start'),/deben estar conectados/);
    assert.equal((await get(host)).stage,'lobby');
    streams.push(await connectEvents(c));
    await act(host,'start');
    const before=await Promise.all([host,b,c].map(get));
    await assert.rejects(act(host,'start'),/Solo el anfitrión/);
    const after=await Promise.all([host,b,c].map(get));
    assert.deepEqual(after.map(s=>s.me),before.map(s=>s.me));
    assert.equal(after[0].stage,'roles');
  }finally{closeStreams(streams);}
});

test('La biblioteca QR se sirve localmente y funciona como script del navegador',async()=>{
  const response=await fetch(base+'/vendor/qrcode.js');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
  const context=vm.createContext({});
  vm.runInContext(await response.text(),context);
  const qr=context.qrcode(0,'M');
  qr.addData(base+'/?sala=ABCDE','Byte');
  qr.make();
  assert.ok(qr.getModuleCount()>=21);
  assert.match(qr.createSvgTag({cellSize:5,margin:20,scalable:true}),/^<svg\s/);
  const invitation=await fetch(base+'/?sala=ABCDE');
  assert.equal(invitation.status,200);
  assert.match(await invitation.text(),/\/vendor\/qrcode.js/);
});
