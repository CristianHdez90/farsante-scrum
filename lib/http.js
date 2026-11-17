'use strict';
const {fail}=require('./game');
function json(res,status,obj) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if(req.body!==undefined){
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(raw.length>30000)fail('Solicitud demasiado grande',413);
    try{return JSON.parse(raw);}catch{fail('JSON no válido');}
  }
  let data='';
  for await (const chunk of req) {
    data+=chunk;
    if(data.length>30000)fail('Solicitud demasiado grande',413);
  }
  try{return JSON.parse(data||'{}');} catch{fail('JSON no válido');}
}
module.exports={json,readBody};
