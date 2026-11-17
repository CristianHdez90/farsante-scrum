'use strict';
const {createSharedEndpoint}=require('../lib/shared-api');
const {json}=require('../lib/http');
const endpoint=createSharedEndpoint();
module.exports=async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const route=url.searchParams.get('endpoint')||req.query?.endpoint||url.pathname.replace(/^\/api\/?/,'');
    // Vercel can parse JSON bodies before invoking a Node.js handler.
    await endpoint(req,res,`/api/${route}`,url.searchParams);
  }catch(e){json(res,e.status||500,{error:e.status?e.message:'Error interno del servidor'});}
};
