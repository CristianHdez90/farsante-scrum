'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vendor=path.join(__dirname,'../public/vendor');
fs.mkdirSync(vendor,{recursive:true});
fs.copyFileSync(require.resolve('qrcode-generator'),path.join(vendor,'qrcode.js'));
console.log('Archivos públicos y biblioteca QR preparados.');
