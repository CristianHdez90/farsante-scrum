'use strict';
// Farsante Scrum — servidor multijugador HTTP/SSE con APIs nativas de Node.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const {ROOMS,DEFAULT_WORDS,normalize,createRoom,addPlayer,getPlayer,publicState,publish,action,validWords,cleanName,fail,MAX_PLAYERS}=require('./lib/game');
const {json,readBody}=require('./lib/http');
const {createSharedEndpoint,hasRedisConfig}=require('./lib/shared-api');
const sharedEndpoint=createSharedEndpoint();
const endpoint = async (req,res,pathname,searchParams) => {
  if(req.method==='POST' && pathname==='/api/create') {
    const body=await readBody(req); const name=cleanName(body.name);
    if(name.length<2)fail('Escribe un nombre de al menos 2 caracteres');
    const {room,player}=createRoom(name,validWords(body.words));
    return json(res,201,{room:room.code,token:player.token,playerId:player.id});
  }
  if(req.method==='POST' && pathname==='/api/join') {
    const body=await readBody(req), name=cleanName(body.name),code=String(body.room||'').trim().toUpperCase();
    const room=ROOMS.get(code);
    if(!room)fail('La sala no existe',404);
    if(room.stage!=='lobby')fail('La partida ya comenzó');
    if(room.players.length>=MAX_PLAYERS)fail('La sala está llena');
    if(name.length<2)fail('Escribe un nombre de al menos 2 caracteres');
    if(room.players.some(p=>normalize(p.name)===normalize(name)))fail('Ese nombre ya está en uso');
    const player=addPlayer(room,name);
    publish(room);
    return json(res,201,{room:code,token:player.token,playerId:player.id});
  }
  if((req.method==='POST'&&pathname==='/api/action')||(req.method==='GET'&&(pathname==='/api/state'||pathname==='/api/events'))) {
    const body=req.method==='POST'?await readBody(req):Object.fromEntries(searchParams);
    const room=ROOMS.get(String(body.room||'').toUpperCase());
    if(!room)fail('Sala no encontrada',404);
    const player=getPlayer(room,body.token);
    if(!player)fail('Sesión no válida',403);
    if(pathname==='/api/action') {action(room,player,body);return json(res,200,{ok:true});}
    if(pathname==='/api/state')return json(res,200,publicState(room,player));
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(': conectado\n\n');
    if(!room.streams.has(player.id))room.streams.set(player.id,new Set());
    room.streams.get(player.id).add(res);
    publish(room);
    const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},25000);
    const cleanup=()=>{
      clearInterval(ping);room.streams.get(player.id)?.delete(res);
      publish(room);
    };
    res.on('close',cleanup);
    return;
  }
  fail('Ruta no encontrada',404);
};
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    const shared=hasRedisConfig()||process.env.UPSTASH_REDIS_REST_URL||process.env.UPSTASH_REDIS_REST_TOKEN||process.env.VERCEL;
    if(url.pathname==='/health' && req.method==='GET')return shared?await sharedEndpoint(req,res,'/api/health',url.searchParams):json(res,200,{status:'ok'});
    if(url.pathname.startsWith('/api/'))return await (shared ? sharedEndpoint : endpoint)(req,res,url.pathname,url.searchParams);
    if(req.method!=='GET'&&req.method!=='HEAD')fail('Método no permitido',405);
    if(url.pathname==='/vendor/qrcode.js') {
      res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD')res.end();else fs.createReadStream(require.resolve('qrcode-generator')).pipe(res);
      return;
    }
    const file = url.pathname==='/' ? '/index.html' : url.pathname;
    const resolved = path.resolve(ROOT, `.${decodeURIComponent(file)}`);
    if(!resolved.startsWith(ROOT+path.sep))fail('Ruta no válida',403);
    const stat=await fs.promises.stat(resolved).catch(()=>null);
    if(!stat||!stat.isFile())fail('Página no encontrada',404);
    res.writeHead(200,{'Content-Type':MIME[path.extname(resolved)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});
    if(req.method==='HEAD')res.end(); else fs.createReadStream(resolved).pipe(res);
  }catch(err){json(res,err.status||500,{error:err.status?err.message:'Error interno del servidor'});}
});
// Expiración de salas inactivas (la información se guarda en memoria).
setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of ROOMS)if(now-room.lastActivity>6*3600*1000){if(room.timer)clearTimeout(room.timer);ROOMS.delete(code);}
},15*60*1000).unref();
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`Farsante Scrum disponible en http://localhost:${PORT}`));
module.exports={server,ROOMS,DEFAULT_WORDS,normalize};
