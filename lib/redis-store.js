'use strict';
const {fail}=require('./game');
const TTL=6*60*60;
const CAS=`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL', KEYS[1])
else redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) end
return 1`;

class RedisStore {
  constructor({url,token,prefix='farsante:production',fetchImpl=fetch}){
    this.url=url;this.token=token;this.prefix=prefix;this.fetch=fetchImpl;
  }
  async command(args){
    if(!this.url||!this.token)fail('Configura UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN en el servidor',503);
    try {
      const response=await this.fetch(this.url,{
        method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},
        body:JSON.stringify(args),signal:AbortSignal.timeout(10000)
      });
      if(!response.ok)throw new Error('Redis HTTP error');
      const data=await response.json();
      if(data.error)throw new Error('Redis command error');
      return data.result;
    }catch{fail('No se pudo acceder a las salas. Intenta de nuevo en unos segundos.',503);}
  }
  key(code){return `${this.prefix}:room:${code}`;}
  serialize(room){
    const {streams,timer,transitionTime,...saved}=room;
    return JSON.stringify(saved);
  }
  async create(room){
    return await this.command(['SET',this.key(room.code),this.serialize(room),'EX',TTL,'NX'])==='OK';
  }
  async update(code,mutate){
    for(let attempt=0;attempt<12;attempt++){
      const raw=await this.command(['GET',this.key(code)]);
      if(raw===null)fail('Sala no encontrada',404);
      const room=JSON.parse(raw);
      room.shared=true;room.timer=null;room.streams=new Map();
      const result=mutate(room);
      const next=room.players.length?this.serialize(room):'';
      // The comparison and write are atomic, including deletion of an empty room.
      const saved=await this.command(['EVAL',CAS,1,this.key(code),raw,next,TTL]);
      if(saved===1)return result;
    }
    fail('La sala está ocupada. Intenta la acción de nuevo.',409);
  }
}
module.exports={RedisStore};
