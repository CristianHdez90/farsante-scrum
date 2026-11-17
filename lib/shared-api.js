'use strict';
const {RedisStore}=require('./redis-store');
const {createRoom,addPlayer,getPlayer,publicState,action,advanceExpired,validWords,cleanName,normalize,fail,MAX_PLAYERS}=require('./game');
const {json,readBody}=require('./http');
const hasRedisConfig=()=>Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN);
function createSharedEndpoint(store){
  // Credentials are only used on the server, never included in public assets.
  const getStore=()=>store||new RedisStore({
    url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN,
    prefix:process.env.REDIS_KEY_PREFIX||`farsante:${process.env.VERCEL_ENV||'development'}`
  });
  return async (req,res,pathname,searchParams)=>{
    const db=getStore();
    if(req.method==='GET'&&pathname==='/api/health'){
      await db.command(['PING']);
      return json(res,200,{status:'ok'});
    }
    if(req.method==='POST'&&pathname==='/api/create'){
      const body=await readBody(req),name=cleanName(body.name);
      if(name.length<2)fail('Escribe un nombre de al menos 2 caracteres');
      for(let i=0;i<12;i++){
        const {room,player}=createRoom(name,validWords(body.words),{shared:true});
        player.lastSeen=Date.now();
        if(await db.create(room))return json(res,201,{room:room.code,token:player.token,playerId:player.id});
      }
      fail('No se pudo crear la sala. Intenta de nuevo.',503);
    }
    const isJoin=req.method==='POST'&&pathname==='/api/join';
    const isAction=req.method==='POST'&&pathname==='/api/action';
    const isState=req.method==='GET'&&pathname==='/api/state';
    if(!isJoin&&!isAction&&!isState)fail('Ruta no encontrada',404);
    const body=req.method==='POST'?await readBody(req):Object.fromEntries(searchParams);
    const code=String(body.room||'').trim().toUpperCase();
    if(!/^[A-Z]{5}$/.test(code))fail('Código de sala no válido');
    const result=await db.update(code,room=>{
      if(isJoin){
        const name=cleanName(body.name);
        if(room.stage!=='lobby')fail('La partida ya comenzó');
        if(room.players.length>=MAX_PLAYERS)fail('La sala está llena');
        if(name.length<2)fail('Escribe un nombre de al menos 2 caracteres');
        if(room.players.some(p=>normalize(p.name)===normalize(name)))fail('Ese nombre ya está en uso');
        const player=addPlayer(room,name);player.lastSeen=Date.now();room.lastActivity=Date.now();
        return {room:code,token:player.token,playerId:player.id};
      }
      const player=getPlayer(room,body.token);
      if(!player)fail('Sesión no válida',403);
      player.lastSeen=Date.now();
      advanceExpired(room);
      let error;
      if(isAction){try{action(room,player,body);}catch(e){error=e;}}
      room.lastActivity=Date.now();
      // Persist expired transitions even when the submitted action is too late.
      if(error)return {error};
      return isAction?{ok:true,state:body.type==='leave'?null:publicState(room,player)}:publicState(room,player);
    });
    if(result.error)throw result.error;
    return json(res,isJoin?201:200,result);
  };
}
module.exports={createSharedEndpoint,hasRedisConfig};
