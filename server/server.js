#!/usr/bin/env node
/* TRS · controle no celular — servidor local de pareamento (sem dependências: só módulos do Node).
   - Serve o jogo (pasta de --game) na raiz, o controle em /controller/ e o cliente do lado do jogo em /mobile/.
   - WebSocket próprio (RFC 6455) em /ws.
   - Sessão do anfitrião com PIN de 6 dígitos que expira; limite de tentativas por IP; autorização do anfitrião;
     token por controle para reconexão segura; validação e limite de frequência das mensagens; limpeza ao desconectar.
   O servidor NÃO roda a partida: só repassa entradas do celular para o navegador do computador.
   Uso: node server/server.js [porta] [--game PASTA]
        porta: padrão 8080 (variável PORT também funciona)
        --game: pasta do jogo (variável TRS_GAME_DIR também funciona; padrão: ../game-trs ao lado deste repo, se existir) */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const ROOT=path.resolve(__dirname,'..');
const argv=process.argv.slice(2);const flag=k=>{const i=argv.indexOf(k);return i>=0?argv.splice(i,2)[1]:undefined;};
const gameArg=flag('--game');
const PORT=+(argv[0]||process.env.PORT||8080);
const GAME=(()=>{const want=gameArg||process.env.TRS_GAME_DIR;const d=path.resolve(want||path.join(ROOT,'..','game-trs'));
 try{if(fs.statSync(path.join(d,'index.html')).isFile())return d;}catch(e){}
 if(want){console.error('Pasta do jogo inválida (sem index.html): '+d);process.exit(1);}return null;})();
/* prefixo da URL → pasta servida. O jogo fica na raiz; o controle e o cliente vêm deste repo. */
const MOUNTS=[['/controller/',path.join(ROOT,'controller')],['/mobile/',path.join(ROOT,'client')]];
const E=(k,d)=>process.env[k]?+process.env[k]:d;/* valores ajustáveis por variável de ambiente (usado nos testes) */
const PIN_TTL=E('TRS_PIN_TTL',10*60e3),SESSION_TTL=4*3600e3,RESUME_TTL=E('TRS_RESUME_TTL',90e3),HOST_RESUME_TTL=5*60e3,MAX_CTRL=4,MAX_MSG=4096,RATE=90,ATTEMPTS=5,ATTEMPT_WINDOW=60e3,BLOCK=E('TRS_BLOCK',120e3);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.ttf':'font/ttf','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.ico':'image/x-icon'};
const log=(...a)=>{if(!process.env.TRS_QUIET)console.log(new Date().toISOString().slice(11,19),...a);};
/* Endereços IPv4 da rede local, o mais provável de ser o Wi-Fi primeiro (o QR usa o primeiro).
   172.16–31 costuma ser adaptador virtual (WSL, Hyper-V, Docker) e 169.254 é autoconfiguração sem rede. */
function ipRank(a,name){let r=/^192\.168\./.test(a)?0:/^10\./.test(a)?1:/^172\.(1[6-9]|2\d|3[01])\./.test(a)?2:/^169\.254\./.test(a)?4:3;
 if(/vethernet|wsl|docker|virtualbox|vmware|hyper-v|vbox|tailscale|zerotier/i.test(name))r+=5;return r;}
function lanUrls(){const out=[];for(const [name,list] of Object.entries(os.networkInterfaces()))for(const n of list||[])if(n.family==='IPv4'&&!n.internal)out.push({a:n.address,r:ipRank(n.address,name)});
 out.sort((x,y)=>x.r-y.r);return out.length?out.map(o=>`http://${o.a}:${PORT}`):[`http://localhost:${PORT}`];}
/* ---------------- HTTP estático ---------------- */
const server=http.createServer((req,res)=>{let u;try{u=new URL(req.url,'http://x');}catch(e){res.writeHead(400);return res.end();}
 if(u.pathname==='/api/info'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({lan:lanUrls(),controller:lanUrls().map(x=>x+'/controller/')}));}
 let p;try{p=decodeURIComponent(u.pathname);}catch(e){res.writeHead(400);return res.end();}
 if(p==='/controller'||p==='/mobile'){res.writeHead(301,{location:p+'/'});return res.end();}if(p.endsWith('/'))p+='index.html';
 const m=MOUNTS.find(([pre])=>p.startsWith(pre));const base=m?m[1]:GAME;
 if(!base){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><title>TRS · controle</title><p>Servidor ativo, mas sem jogo. Rode com <code>--game CAMINHO/DO/game-trs</code>. O controle está em <a href="/controller/">/controller/</a>.</p>');}
 const file=path.resolve(base,'.'+(m?p.slice(m[0].length-1):p));
 if(!file.startsWith(base+path.sep)||/[\\/]\.\w/.test(p)||p.includes('/server/')||p.includes('/node_modules/')){res.writeHead(403);return res.end('Proibido');}
 fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});return res.end('Não encontrado');}
  res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});fs.createReadStream(file).pipe(res);});});
/* ---------------- WebSocket mínimo ---------------- */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade',(req,sock)=>{let u;try{u=new URL(req.url,'http://x');}catch(e){return sock.destroy();}
 const key=req.headers['sec-websocket-key'];if(u.pathname!=='/ws'||!key||req.headers.upgrade?.toLowerCase()!=='websocket'){sock.write('HTTP/1.1 400 Bad Request\r\n\r\n');return sock.destroy();}
 const acc=crypto.createHash('sha1').update(key+GUID).digest('base64');
 sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);sock.setNoDelay(true);
 /* IP real do socket. X-Forwarded-For só vale atrás de um proxy confiável (TRS_TRUST_PROXY=1): na rede local qualquer
    celular poderia forjar o cabeçalho e escapar do bloqueio de PIN e da recusa do anfitrião. */
 const ip=(process.env.TRS_TRUST_PROXY==='1'&&req.headers['x-forwarded-for']||sock.remoteAddress||'').toString().split(',')[0].trim().replace(/^::ffff:/,'');
 const ws=new WS(sock,ip);onConnect(ws);});
class WS{constructor(sock,ip){this.sock=sock;this.ip=ip;this.buf=Buffer.alloc(0);this.open=true;this.onmessage=null;this.onclose=null;this.frag=null;this.alive=Date.now();
  sock.on('data',d=>{this.buf=Buffer.concat([this.buf,d]);if(this.buf.length>65536)return this.close(1009);this.parse();});sock.on('close',()=>this.closed());sock.on('error',()=>this.closed());}
 parse(){while(this.buf.length>=2){const b0=this.buf[0],b1=this.buf[1];const fin=!!(b0&0x80),op=b0&0x0f,masked=!!(b1&0x80);let len=b1&0x7f,off=2;
  if(!masked)return this.close(1002);/* clientes devem mascarar */
  if(len===126){if(this.buf.length<4)return;len=this.buf.readUInt16BE(2);off=4;}else if(len===127){if(this.buf.length<10)return;const hi=this.buf.readUInt32BE(2);if(hi)return this.close(1009);len=this.buf.readUInt32BE(6);off=10;}
  if(len>MAX_MSG)return this.close(1009);if(this.buf.length<off+4+len)return;const mask=this.buf.slice(off,off+4);const data=Buffer.alloc(len);for(let i=0;i<len;i++)data[i]=this.buf[off+4+i]^mask[i&3];this.buf=this.buf.slice(off+4+len);this.alive=Date.now();
  if(op===8){this.close(1000);return;}if(op===9){this.frame(10,data);continue;}if(op===10)continue;
  if(op===1||op===0){if(!fin){this.frag=Buffer.concat([this.frag||Buffer.alloc(0),data]);if(this.frag.length>MAX_MSG)return this.close(1009);continue;}const msg=this.frag?Buffer.concat([this.frag,data]):data;this.frag=null;if(this.onmessage)try{this.onmessage(msg.toString('utf8'));}catch(e){log('erro',e.message);}}}}
 frame(op,data){if(!this.open)return;const n=data.length;let h;if(n<126){h=Buffer.from([0x80|op,n]);}else if(n<65536){h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(n,2);}else{h=Buffer.alloc(10);h[0]=0x80|op;h[1]=127;h.writeUInt32BE(0,2);h.writeUInt32BE(n,6);}try{this.sock.write(Buffer.concat([h,data]));}catch(e){}}
 send(o){this.frame(1,Buffer.from(JSON.stringify(o)));}
 close(code){if(!this.open)return;const b=Buffer.alloc(2);b.writeUInt16BE(code||1000,0);this.frame(8,b);this.open=false;try{this.sock.end();}catch(e){}this.closed();}
 closed(){if(this.done)return;this.done=true;this.open=false;try{this.sock.destroy();}catch(e){}if(this.onclose)this.onclose();}}
/* ---------------- sessões ---------------- */
const sessions=new Map(),byPin=new Map(),attempts=new Map();
const rid=n=>crypto.randomBytes(n).toString('hex');
function newPin(){for(let i=0;i<50;i++){const p=String(crypto.randomInt(0,1e6)).padStart(6,'0');if(!byPin.has(p))return p;}throw Error('sem PIN livre');}
function blocked(ip){const a=attempts.get(ip);return a&&a.until>Date.now();}
function failAttempt(ip){const now=Date.now();let a=attempts.get(ip);if(!a||now-a.t0>ATTEMPT_WINDOW)a={t0:now,n:0,until:0};a.n++;if(a.n>=ATTEMPTS){a.until=now+BLOCK;log('IP bloqueado por tentativas de PIN:',ip);}attempts.set(ip,a);}
function hostSend(s,o){if(s.host&&s.host.open)s.host.send(o);}
function endSession(s,why){for(const c of s.ctrls.values()){if(c.ws&&c.ws.open){c.ws.send({t:'session-ended',why});c.ws.close(1000);}}byPin.delete(s.pin);sessions.delete(s.id);hostSend(s,{t:'session-ended',why});log('sessão encerrada',s.id,why);}
const num=(v,min,max)=>typeof v==='number'&&isFinite(v)&&v>=min&&v<=max;
function onConnect(ws){let role=null,sess=null,ctrl=null;
 ws.onmessage=raw=>{let m;try{m=JSON.parse(raw);}catch(e){return;}if(!m||typeof m.t!=='string')return;
  /* ---- anfitrião (computador) ---- */
  if(m.t==='host-create'){if(sess)endSession(sess,'novo PIN');const s={id:rid(8),pin:newPin(),hostToken:rid(16),host:ws,created:Date.now(),pinExpires:Date.now()+PIN_TTL,ctrls:new Map(),denied:new Set(),hostGoneAt:0};sessions.set(s.id,s);byPin.set(s.pin,s);sess=s;role='host';
   ws.send({t:'session',id:s.id,pin:s.pin,hostToken:s.hostToken,expires:s.pinExpires,urls:lanUrls().map(x=>x+'/controller/')});log('sessão criada',s.id,'PIN',s.pin);return;}
  if(m.t==='host-resume'){const s=sessions.get(m.id);if(!s||s.hostToken!==m.hostToken){ws.send({t:'error',code:'session',msg:'Sessão expirada; crie outra.'});return;}s.host=ws;s.hostGoneAt=0;sess=s;role='host';
   ws.send({t:'session',id:s.id,pin:s.pin,hostToken:s.hostToken,expires:s.pinExpires,urls:lanUrls().map(x=>x+'/controller/')});
   for(const c of s.ctrls.values()){ws.send({t:'ctrl-state',cid:c.cid,name:c.name,label:c.label,state:c.approved?(c.ws&&c.ws.open?'connected':'reconnecting'):'pending'});if(c.ws&&c.ws.open)c.ws.send({t:'host-back'});}return;}
  if(role==='host'&&sess){const s=sess;
   if(m.t==='approve'||m.t==='deny'){const c=s.ctrls.get(m.cid);if(!c||c.approved)return;
    /* recusa vale para a sessão inteira: o mesmo aparelho (ID) e o mesmo IP não podem pedir de novo até um NOVO PIN */
    if(m.t==='deny'){s.denied.add('ip:'+c.ip);for(const d of c.devs)s.denied.add('dev:'+d);c.ws&&c.ws.open&&(c.ws.send({t:'denied'}),c.ws.close(1000));s.ctrls.delete(c.cid);log('controle recusado',c.cid,c.ip);return;}
    c.approved=true;c.token=rid(16);c.label='CELULAR '+([...s.ctrls.values()].filter(x=>x.approved).length);const on=!!(c.ws&&c.ws.open);if(on)c.ws.send({t:'paired',sid:s.id,cid:c.cid,token:c.token,label:c.label});
    hostSend(s,{t:'ctrl-state',cid:c.cid,name:c.name,label:c.label,state:on?'connected':'reconnecting'});log('controle autorizado',c.cid,c.label);return;}
   if(m.t==='kick'){const c=s.ctrls.get(m.cid);if(c){c.ws&&c.ws.open&&(c.ws.send({t:'kicked'}),c.ws.close(1000));s.ctrls.delete(c.cid);}return;}
   if(m.t==='to-ctrl'){const c=s.ctrls.get(m.cid);if(c&&c.approved&&c.ws&&c.ws.open&&m.msg&&typeof m.msg==='object'){const t=String(m.msg.t||'');if(['state','rumble','hello'].includes(t))c.ws.send(m.msg);}return;}
   if(m.t==='host-close'){endSession(s,'encerrada pelo anfitrião');sess=null;return;}
   if(m.t==='ping'){ws.send({t:'pong',ts:m.ts});return;}return;}
  /* ---- controle (celular) ---- */
  if(m.t==='join'){if(blocked(ws.ip)){ws.send({t:'error',code:'blocked',msg:'Muitas tentativas. Aguarde 2 minutos.'});return;}
   const pin=String(m.pin||'').replace(/\D/g,'');const s=byPin.get(pin);
   if(!s||Date.now()>s.pinExpires){failAttempt(ws.ip);ws.send({t:'error',code:'pin',msg:'PIN inválido ou expirado.'});return;}
   /* Um pedido por aparelho e por sessão. dev = ID aleatório guardado no celular; o IP cobre quem apaga os dados do navegador. */
   const dev=typeof m.dev==='string'&&/^[0-9a-f]{32}$/.test(m.dev)?m.dev:null;
   const all=[...s.ctrls.values()];const mine=dev&&all.find(x=>x.devs.has(dev));
   if(!(mine&&mine.approved)&&(s.denied.has('ip:'+ws.ip)||dev&&s.denied.has('dev:'+dev))){ws.send({t:'error',code:'denied',msg:'O computador recusou este celular nesta sessão. Para tentar de novo, peça um NOVO PIN no computador.'});return;}
   const known=mine||all.find(x=>!x.approved&&x.ip===ws.ip);
   if(known){/* mesmo aparelho de novo (recarregou, leu o QR outra vez, caiu a rede): reaproveita o pedido, sem avisar o anfitrião de novo */
    const c=known,old=c.ws;c.ws=ws;c.goneAt=0;if(dev)c.devs.add(dev);ctrl=c;sess=s;role='ctrl';if(old&&old!==ws&&old.open){old.send({t:'replaced'});old.close(1000);}
    if(c.approved){c.lastSeq=-1;ws.send({t:'paired',sid:s.id,cid:c.cid,token:c.token,label:c.label,resumed:true});hostSend(s,{t:'ctrl-state',cid:c.cid,name:c.name,label:c.label,state:'connected'});}
    else ws.send({t:'wait-approval',cid:c.cid,again:true});
    log('pedido repetido reaproveitado',c.cid,ws.ip);return;}
   if(all.length>=MAX_CTRL){ws.send({t:'error',code:'full',msg:'Sessão cheia (máx. 4 controles).'});return;}
   const c={cid:rid(5),devs:new Set(dev?[dev]:[]),name:String(m.name||'Celular').slice(0,24).replace(/[<>]/g,''),ws,approved:false,token:null,lastSeq:-1,bucket:RATE,bt:Date.now(),goneAt:0,ip:ws.ip};s.ctrls.set(c.cid,c);ctrl=c;sess=s;role='ctrl';
   ws.send({t:'wait-approval',cid:c.cid});hostSend(s,{t:'pair-request',cid:c.cid,name:c.name});log('pedido de pareamento',c.cid,ws.ip);return;}
  if(m.t==='resume'){const s=sessions.get(m.sid);const c=s&&s.ctrls.get(m.cid);if(!c||!c.approved||c.token!==m.token){failAttempt(ws.ip);ws.send({t:'error',code:'resume',msg:'Reconexão recusada; digite o PIN novamente.'});return;}
   if(c.ws&&c.ws!==ws&&c.ws.open)c.ws.close(1000);c.ws=ws;c.goneAt=0;c.lastSeq=-1;ctrl=c;sess=s;role='ctrl';ws.send({t:'paired',sid:s.id,cid:c.cid,token:c.token,label:c.label,resumed:true});hostSend(s,{t:'ctrl-state',cid:c.cid,name:c.name,label:c.label,state:'connected'});return;}
  if(role==='ctrl'&&ctrl&&sess){const c=ctrl;
   if(m.t==='in'){if(!c.approved)return;/* limite de frequência (balde de fichas) */const now=Date.now();c.bucket=Math.min(RATE,c.bucket+(now-c.bt)/1000*RATE);c.bt=now;if(c.bucket<1)return;c.bucket--;
    if(!num(m.s,0,1e12)||m.s<=c.lastSeq||!num(m.x,-1,1)||!num(m.y,-1,1)||!Number.isInteger(m.b)||m.b<0||m.b>1023)return;c.lastSeq=m.s;hostSend(sess,{t:'ctrl-in',cid:c.cid,s:m.s,x:m.x,y:m.y,b:m.b});return;}
   if(m.t==='ping'){ws.send({t:'pong',ts:m.ts});return;}
   if(m.t==='rtt'&&num(m.rtt,0,10000)){hostSend(sess,{t:'ctrl-rtt',cid:c.cid,rtt:Math.round(m.rtt)});return;}}};
 ws.onclose=()=>{if(role==='host'&&sess&&sess.host===ws){sess.hostGoneAt=Date.now();for(const c of sess.ctrls.values())c.ws&&c.ws.open&&c.ws.send({t:'host-away'});}
  /* pedido pendente que caiu continua na fila (o anfitrião ainda pode autorizar); a limpeza tira depois de RESUME_TTL */
  if(role==='ctrl'&&ctrl&&sess&&ctrl.ws===ws){ctrl.goneAt=Date.now();if(ctrl.approved)hostSend(sess,{t:'ctrl-state',cid:ctrl.cid,name:ctrl.name,label:ctrl.label,state:'reconnecting'});}};}
/* limpeza periódica: PIN expirado, controles que não voltaram, anfitrião ausente, sessões antigas */
setInterval(()=>{const now=Date.now();for(const s of sessions.values()){if(now>s.pinExpires&&byPin.get(s.pin)===s)byPin.delete(s.pin);
  for(const c of s.ctrls.values())if(c.goneAt&&now-c.goneAt>RESUME_TTL){s.ctrls.delete(c.cid);hostSend(s,{t:'ctrl-state',cid:c.cid,state:'gone'});}
  if(s.hostGoneAt&&now-s.hostGoneAt>HOST_RESUME_TTL||now-s.created>SESSION_TTL)endSession(s,'tempo esgotado');}
 for(const [ip,a] of attempts)if(now-a.t0>ATTEMPT_WINDOW&&a.until<now)attempts.delete(ip);},E('TRS_SWEEP',5000)).unref();
server.listen(PORT,'0.0.0.0',()=>{console.log(`\nTRS · controle no celular — servidor local na porta ${PORT}`);console.log(GAME?'Jogo: '+GAME:'Sem jogo (use --game CAMINHO/DO/game-trs).');console.log('Abra o JOGO no computador:');for(const u of lanUrls())console.log('   '+u+'/');console.log('Abra o CONTROLE no celular (mesma rede Wi-Fi):');for(const u of lanUrls())console.log('   '+u+'/controller/');console.log('Ctrl+C para encerrar.\n');});
module.exports={server};
