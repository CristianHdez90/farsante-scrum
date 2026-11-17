'use strict';
// Test double for the Redis REST protocol. No credentials or external service.
const http=require('node:http');
function createRedisFixture(){
  const entries=new Map();
  const read=key=>{
    const entry=entries.get(key);
    if(entry&&entry.until<=Date.now()){entries.delete(key);return null;}
    return entry?.value??null;
  };
  function execute(args){
    const [command,key,value,...options]=args;
    if(command==='PING')return 'PONG';
    if(command==='GET')return read(key);
    if(command==='SET'){
      if(options.includes('NX')&&read(key)!==null)return null;
      entries.set(key,{value,until:Date.now()+Number(options[options.indexOf('EX')+1])*1000});return 'OK';
    }
    if(command==='EVAL'){
      const [,script,keyCount,roomKey,expected,next,ttl]=args;
      if(keyCount!==1||!script.includes("redis.call('GET'"))throw new Error('Unexpected script');
      if(read(roomKey)!==expected)return 0;
      if(next==='')entries.delete(roomKey);
      else entries.set(roomKey,{value:next,until:Date.now()+Number(ttl)*1000});
      return 1;
    }
    throw new Error('Unsupported Redis test command');
  }
  const server=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer test-token'){res.writeHead(401);res.end();return;}
    try{
      let body='';for await(const chunk of req)body+=chunk;
      const result=execute(JSON.parse(body));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({result}));
    }catch{res.writeHead(400);res.end();}
  });
  return {server,entries,execute};
}
if(require.main===module){
  const {server}=createRedisFixture();
  server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
}
module.exports={createRedisFixture};
