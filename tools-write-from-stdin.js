process.stdin.setEncoding('utf8');
let buf='';
process.stdin.on('data', c=>buf+=c);
process.stdin.on('end',()=>{const obj=JSON.parse(buf);const fs=require('fs');const path=require('path');fs.mkdirSync(path.dirname(obj.target),{recursive:true});const data=Buffer.from(obj.b64,'base64').toString('utf8');fs.writeFileSync(obj.target,data);console.log('wrote',obj.target,data.length,'bytes');});
