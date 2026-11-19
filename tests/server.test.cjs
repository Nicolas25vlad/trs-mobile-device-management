'use strict';
/* TRS · controle no celular — teste REAL do servidor de pareamento (processo Node separado, HTTP e WebSocket de verdade).
   Clientes: o WebSocket nativo do Node faz o papel do computador (anfitrião) e de dois celulares.
   O "jogo" é uma pasta temporária com um index.html (o jogo de verdade vive no repo game-trs).
   Não substitui um teste com celulares físicos; verifica o protocolo, a segurança e o repasse de comandos. */
const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const path=require('node:path');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');
const GAME=fs.mkdtempSync(path.join(os.tmpdir(),'trs-game-'));fs.writeFileSync(path.join(GAME,'index.html'),'<!doctype html><title>TRS26</title>');
fs.mkdirSync(path.join(GAME,'server'));fs.writeFileSync(path.join(GAME,'server','segredo.js'),'// não deve ser servido');
const PORT=18000+Math.floor(Math.random()*900);const base=`http://127.0.0.1:${PORT}`;
let checks=0;const ok=(c,msg)=>{assert.ok(c,msg);checks++;console.log('  ✓ '+msg);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(p){return new Promise((res,rej)=>{http.get(base+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d,type:r.headers['content-type']}));}).on('error',rej);});}
function client(headers){const ws=headers?new WebSocket(`ws://127.0.0.1:${PORT}/ws`,{headers}):new WebSocket(`ws://127.0.0.1:${PORT}/ws`);const q=[];const waiters=[];ws.onmessage=e=>{const m=JSON.parse(e.data);q.push(m);for(const w of waiters.splice(0))w();};
 const c={ws,q,send:o=>ws.send(JSON.stringify(o)),open:()=>new Promise(r=>ws.readyState===1?r():ws.addEventListener('open',r,{once:true})),
  wait:async(pred,ms=3000)=>{const t0=Date.now();for(;;){const i=q.findIndex(pred);if(i>=0)return q.splice(i,1)[0];if(Date.now()-t0>ms)return null;await new Promise(r=>{waiters.push(r);setTimeout(r,50);});}},
  close:()=>ws.close()};return c;}
(async()=>{
 const srv=spawn(process.execPath,[path.join(__dirname,'..','server','server.js'),String(PORT),'--game',GAME],{env:{...process.env,TRS_QUIET:'1',TRS_PIN_TTL:'8000',TRS_BLOCK:'1500',TRS_RESUME_TTL:'4000',TRS_SWEEP:'300'},stdio:['ignore','pipe','pipe']});
 let out='';srv.stdout.on('data',d=>out+=d);srv.stderr.on('data',d=>out+=d);
 try{for(let i=0;i<50&&!out.includes('servidor local');i++)await sleep(100);
  console.log('HTTP:');
  const idx=await get('/');ok(idx.status===200&&idx.body.includes('TRS26'),'serve o jogo na rede local');
  const ctl=await get('/controller/');ok(ctl.status===200&&ctl.body.includes('CONTROLE VIRTUAL'),'serve a página do controle virtual');
  const rjs=await get('/mobile/remote.js'),qjs=await get('/mobile/qr.js');ok(rjs.status===200&&rjs.body.includes('MD.Remote')&&qjs.status===200&&qjs.body.includes('MD.QR'),'serve o cliente do jogo em /mobile/ (remote.js e qr.js)');
  ok((await get('/controller')).status===301&&(await get('/controller/logo.webp')).status===200,'/controller redireciona para /controller/ e serve o logo');
  ok((await get('/server/segredo.js')).status===403,'não expõe pastas server/');ok([403,404].includes((await get('/..%2f..%2fetc/passwd')).status),'bloqueia travessia de diretório');
  ok([403,404].includes((await get('/controller/..%2f..%2fserver%2fserver.js')).status)&&[403,404].includes((await get('/mobile/..%2fserver%2fserver.js')).status),'bloqueia sair de /controller/ e /mobile/ para o código do servidor');
  ok((await get('/%E0%A4%A')).status===400,'URL com escape inválido não derruba o servidor');
  const info=JSON.parse((await get('/api/info')).body);ok(Array.isArray(info.controller)&&info.controller[0].includes('/controller/'),'informa os endereços da rede local');
  console.log('Sessão e PIN:');
  const host=client();await host.open();host.send({t:'host-create'});const ses=await host.wait(m=>m.t==='session');ok(ses&&/^\d{6}$/.test(ses.pin)&&ses.hostToken&&ses.expires>Date.now(),'anfitrião cria sessão com PIN de 6 dígitos que expira');
  const bad=client();await bad.open();for(let i=0;i<5;i++){bad.send({t:'join',pin:String((+ses.pin+1+i)%1e6).padStart(6,'0'),name:'Intruso'});await bad.wait(m=>m.t==='error');}
  bad.send({t:'join',pin:ses.pin,name:'Intruso'});const blk=await bad.wait(m=>m.t==='error');ok(blk&&blk.code==='blocked','5 PINs errados bloqueiam o IP (mesmo com o PIN certo depois)');bad.close();
  await sleep(1700);
  const p1=client();await p1.open();p1.send({t:'join',pin:ses.pin,name:'Celular A'});ok(await p1.wait(m=>m.t==='wait-approval'),'PIN correto: celular aguarda autorização');
  const req=await host.wait(m=>m.t==='pair-request');ok(req&&req.name==='Celular A','anfitrião recebe o pedido de pareamento');
  p1.send({t:'in',s:1,ts:Date.now(),x:1,y:0,b:1});ok(!(await host.wait(m=>m.t==='ctrl-in',400)),'sem autorização do anfitrião nenhum comando chega ao jogo');
  host.send({t:'approve',cid:req.cid});const pr=await p1.wait(m=>m.t==='paired');ok(pr&&pr.token&&pr.label==='CELULAR 1','anfitrião autoriza: o celular recebe token e identificação');
  ok(await host.wait(m=>m.t==='ctrl-state'&&m.state==='connected'),'jogo sabe que o CELULAR 1 está conectado');
  console.log('Comandos:');
  p1.send({t:'in',s:10,ts:Date.now(),x:.5,y:-.25,b:0b11});const in1=await host.wait(m=>m.t==='ctrl-in');ok(in1&&in1.x===.5&&in1.y===-.25&&in1.b===3,'joystick e botões simultâneos chegam ao jogo');
  p1.send({t:'in',s:9,ts:Date.now(),x:-1,y:0,b:0});p1.send({t:'in',s:11,ts:Date.now(),x:5,y:0,b:0});p1.send({t:'in',s:12,ts:Date.now(),x:0,y:0,b:99999});p1.send({t:'in',s:13,ts:Date.now(),x:0,y:0,b:0});
  const after=await host.wait(m=>m.t==='ctrl-in');ok(after&&after.s===13,'pacotes antigos, fora de ordem ou inválidos são descartados');
  host.q.length=0;for(let i=0;i<400;i++)p1.send({t:'in',s:100+i,ts:Date.now(),x:0,y:0,b:0});await sleep(600);const got=host.q.filter(m=>m.t==='ctrl-in').length;ok(got<180&&got>20,`limite de frequência: 400 pacotes enviados de uma vez, ${got} repassados`);
  const t0=Date.now();p1.send({t:'ping',ts:t0});const pong=await p1.wait(m=>m.t==='pong');ok(pong&&Date.now()-t0<200,`latência local medida (${Date.now()-t0} ms)`);
  host.send({t:'to-ctrl',cid:req.cid,msg:{t:'state',label:'P1',side:'home',hasBall:true}});ok(await p1.wait(m=>m.t==='state'&&m.side==='home'),'jogo envia o contexto (lado, posse) ao celular');
  host.send({t:'to-ctrl',cid:req.cid,msg:{t:'eval',code:'x'}});ok(!(await p1.wait(m=>m.t==='eval',300)),'mensagens não permitidas do anfitrião não são repassadas');
  console.log('Dois celulares, desconexão e reconexão:');
  const p2=client();await p2.open();p2.send({t:'join',pin:ses.pin,name:'Celular B'});const req2=await host.wait(m=>m.t==='pair-request');host.send({t:'approve',cid:req2.cid});const pr2=await p2.wait(m=>m.t==='paired');ok(pr2&&pr2.label==='CELULAR 2'&&pr2.cid!==pr.cid,'segundo celular conectado como controle independente');
  p1.close();ok(await host.wait(m=>m.t==='ctrl-state'&&m.cid===req.cid&&m.state==='reconnecting'),'queda do CELULAR 1 é informada ao jogo');
  p2.send({t:'in',s:1,ts:Date.now(),x:-1,y:0,b:0});const in2=await host.wait(m=>m.t==='ctrl-in'&&m.cid===req2.cid);ok(in2&&in2.x===-1,'o CELULAR 2 continua funcionando quando o 1 cai');
  const evil=client();await evil.open();evil.send({t:'resume',sid:pr.sid,cid:pr.cid,token:'errado'});ok((await evil.wait(m=>m.t==='error'))?.code==='resume','reconexão com token falso é recusada');evil.close();
  await sleep(1600);/* desbloqueia o IP após a tentativa falsa */
  const p1b=client();await p1b.open();p1b.send({t:'resume',sid:pr.sid,cid:pr.cid,token:pr.token});const rs=await p1b.wait(m=>m.t==='paired');ok(rs&&rs.resumed&&rs.label==='CELULAR 1','reconexão segura com o token do aparelho (sem novo PIN)');
  ok(await host.wait(m=>m.t==='ctrl-state'&&m.cid===req.cid&&m.state==='connected'),'jogo vê o CELULAR 1 conectado de novo');
  console.log('Expiração e encerramento:');
  await sleep(Math.max(0,ses.expires-Date.now()+400));const late=client();await late.open();late.send({t:'join',pin:ses.pin,name:'Atrasado'});const ex=await late.wait(m=>m.t==='error');ok(ex&&ex.code==='pin','PIN expirado não aceita novos celulares');late.close();
  p1b.send({t:'in',s:1,ts:Date.now(),x:.3,y:0,b:0});ok(await host.wait(m=>m.t==='ctrl-in'&&m.cid===req.cid),'celulares já autorizados continuam após o PIN expirar');
  host.send({t:'host-close'});ok(await p2.wait(m=>m.t==='session-ended')&&await p1b.wait(m=>m.t==='session-ended'),'encerrar a sessão desconecta os celulares');
  console.log('Um pedido de autorização por aparelho:');
  const D1='a'.repeat(32),D2='b'.repeat(32),D3='c'.repeat(32);
  await sleep(1700);/* o PIN expirado acima conta como tentativa errada e bloqueia este IP por TRS_BLOCK */
  const h2=client();await h2.open();h2.send({t:'host-create'});const s2=await h2.wait(m=>m.t==='session');
  const a1=client();await a1.open();a1.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});ok(await a1.wait(m=>m.t==='wait-approval'),'aparelho pede autorização');
  const r1=await h2.wait(m=>m.t==='pair-request');ok(r1,'computador recebe o pedido');
  a1.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});a1.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});
  const a1b=client();await a1b.open();a1b.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});const again=await a1b.wait(m=>m.t==='wait-approval');
  ok(again&&again.again&&again.cid===r1.cid,'pedir de novo (mesma aba ou recarregando) reaproveita o mesmo pedido');
  ok(await a1.wait(m=>m.t==='replaced'),'a aba antiga é avisada de que foi substituída');
  ok(!(await h2.wait(m=>m.t==='pair-request',500)),'o computador NÃO recebe pedidos repetidos');
  const a1c=client();await a1c.open();a1c.send({t:'join',pin:s2.pin,name:'Outro nome',dev:D3});const same=await a1c.wait(m=>m.t==='wait-approval');
  ok(same&&same.cid===r1.cid&&!(await h2.wait(m=>m.t==='pair-request',300)),'mesmo IP com dados apagados (outro ID) também reaproveita o pedido pendente');
  a1c.close();await sleep(200);
  ok(!(await h2.wait(m=>m.t==='ctrl-state'&&m.state==='gone',300)),'pedido pendente que caiu continua na fila do computador');
  h2.send({t:'approve',cid:r1.cid});ok((await h2.wait(m=>m.t==='ctrl-state'&&m.cid===r1.cid))?.state==='reconnecting','autorizado com o celular fora do ar: aparece como reconectando');
  const a1d=client();await a1d.open();a1d.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});const pd=await a1d.wait(m=>m.t==='paired');
  ok(pd&&pd.cid===r1.cid&&pd.token,'ao voltar, o aparelho autorizado entra direto, sem pedir de novo');
  ok(!(await h2.wait(m=>m.t==='pair-request',300)),'nenhum pedido novo para um aparelho já autorizado');
  h2.send({t:'approve',cid:r1.cid});ok(!(await a1d.wait(m=>m.t==='paired',300)),'autorizar duas vezes não gera novo token');
  console.log('Recusa vale para a sessão:');
  const b1=client();await b1.open();b1.send({t:'join',pin:s2.pin,name:'Aparelho 2',dev:D2});await b1.wait(m=>m.t==='wait-approval');const r2=await h2.wait(m=>m.t==='pair-request');
  h2.send({t:'deny',cid:r2.cid});ok(await b1.wait(m=>m.t==='denied'),'computador recusa: o celular é avisado');
  const b2=client();await b2.open();b2.send({t:'join',pin:s2.pin,name:'Aparelho 2',dev:D2});ok((await b2.wait(m=>m.t==='error'))?.code==='denied','o aparelho recusado não consegue pedir de novo');
  b2.send({t:'join',pin:s2.pin,name:'Aparelho 2',dev:'d'.repeat(32)});ok((await b2.wait(m=>m.t==='error'))?.code==='denied','nem trocando o ID (mesmo IP)');
  const b3=client({'x-forwarded-for':'10.9.9.9'});await b3.open();b3.send({t:'join',pin:s2.pin,name:'Aparelho 2',dev:'e'.repeat(32)});ok((await b3.wait(m=>m.t==='error'))?.code==='denied','nem forjando X-Forwarded-For');
  ok(!(await h2.wait(m=>m.t==='pair-request',300)),'o computador não recebe nada do aparelho recusado');
  const a1e=client();await a1e.open();a1e.send({t:'join',pin:s2.pin,name:'Aparelho 1',dev:D1});ok(await a1e.wait(m=>m.t==='paired'),'aparelho já autorizado continua entrando depois da recusa de outro');
  h2.send({t:'host-create'});const s3=await h2.wait(m=>m.t==='session');const b4=client();await b4.open();b4.send({t:'join',pin:s3.pin,name:'Aparelho 2',dev:D2});
  ok(await b4.wait(m=>m.t==='wait-approval')&&await h2.wait(m=>m.t==='pair-request'),'NOVO PIN (nova sessão) permite pedir de novo, uma vez');
  b4.close();ok(await h2.wait(m=>m.t==='ctrl-state'&&m.state==='gone',6000),'pedido pendente que não volta sai da fila depois do tempo de reconexão');
  console.log(`SERVER TEST PASS (${checks} verificações)`);
 }catch(e){console.error(e);console.error(out);process.exitCode=1;}finally{srv.kill();try{fs.rmSync(GAME,{recursive:true,force:true});}catch(e){}setTimeout(()=>process.exit(),200);}
})();
