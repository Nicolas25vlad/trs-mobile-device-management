/* TRS — controle virtual no celular (somente entrada; nenhuma imagem da partida é transmitida).
   Multitoque real com Pointer Events + setPointerCapture: segurar o analógico, correr e passar ao mesmo tempo.
   Envio: analógico até ~60 pacotes/s, botões na hora (apertar e soltar), sinal de vida a cada 100 ms; sequência crescente (o jogo descarta pacotes velhos);
   ao soltar, ao ocultar a página ou ao perder a conexão, o estado é zerado imediatamente. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const BTN=['pass','shoot','cross','through','sprint','switch','skill','tackle','support','pause'];
const CFG_KEY='trs26-pad-cfg',TOK_KEY='trs26-pad-token';
const DEF={btn:1,stick:1,alpha:.92,dead:.12,sens:1,vib:true,mirror:false,dpad:false,fs:true};
/* ID aleatório deste aparelho: o servidor aceita UM pedido de autorização por aparelho e por sessão (pedir de novo reaproveita o mesmo) */
const DEV_KEY='trs26-pad-device';
const deviceId=(()=>{try{let d=localStorage.getItem(DEV_KEY);if(!/^[0-9a-f]{32}$/.test(d||'')){const a=new Uint8Array(16);crypto.getRandomValues(a);d=[...a].map(b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(DEV_KEY,d);}return d;}catch(e){return null;}})();
let cfg={...DEF,...(JSON.parse(localStorage.getItem(CFG_KEY)||'null')||{})};
let ws=null,state='idle',seq=0,lastSend=0,label='',retry=0,paired=null,rtt=0;
let joining=null;/* {pin}: pedido enviado, esperando o computador; se a conexão cair ou a aba recarregar, o mesmo pedido é retomado */
const JOIN_KEY='trs26-pad-joining';
function setJoining(v){joining=v;try{if(v)sessionStorage.setItem(JOIN_KEY,JSON.stringify({pin:v.pin,at:Date.now()}));else sessionStorage.removeItem(JOIN_KEY);}catch(e){}}
let stopped=false;/* outra aba/janela assumiu este controle: não reconectar */
const st={x:0,y:0,b:0};let stickPtr=null;const btnPtrs=new Map();/* pointerId → botão */
function applyCfg(){const r=document.documentElement.style;r.setProperty('--btn',cfg.btn);r.setProperty('--stk',cfg.stick);r.setProperty('--alpha',cfg.alpha);$('pad').classList.toggle('mirror',!!cfg.mirror);
 document.querySelectorAll('[data-cfg]').forEach(i=>{const k=i.dataset.cfg;if(i.type==='checkbox')i.checked=!!cfg[k];else i.value=cfg[k];});localStorage.setItem(CFG_KEY,JSON.stringify(cfg));}
function status(t,cls){const el=$('pair').hidden?$('st'):$('pair-status');el.textContent=t;el.className=(el.id==='st'?'st ':'status ')+(cls||'');}
/* ---------- conexão ---------- */
function connect(then){if(ws&&ws.readyState<=1){if(ws.readyState===1)then&&then();else ws.addEventListener('open',()=>then&&then(),{once:true});return;}
 status('CONECTANDO…','warn');ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
 ws.onopen=()=>{retry=0;then&&then();};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(x){return;}handle(m);};
 ws.onclose=()=>{zero(true);if(stopped)return;
  if(paired){status('RECONECTANDO…','warn');retry++;setTimeout(()=>connect(()=>send({t:'resume',sid:paired.sid,cid:paired.cid,token:paired.token})),Math.min(4000,400*retry));}
  else if(joining){status('RECONECTANDO… (o pedido continua valendo)','warn');retry++;const p=joining.pin;setTimeout(()=>{if(joining&&joining.pin===p)connect(()=>sendJoin(p));},Math.min(4000,400*retry));}
  else status('DESCONECTADO','bad');};
 ws.onerror=()=>status('Servidor não encontrado','err');}
const send=o=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));};
function handle(m){switch(m.t){
 case'wait-approval':status(m.again?'PEDIDO JÁ ENVIADO · AGUARDANDO O COMPUTADOR…':'AGUARDANDO AUTORIZAÇÃO NO COMPUTADOR…','warn');lockForm(true);break;
 case'replaced':stopped=true;setJoining(null);zero(true);showPair();lockForm(false);status('Este controle foi aberto em outra aba. Use aquela.','err');break;
 case'paired':pendingPin=null;setJoining(null);lockForm(false);paired={sid:m.sid,cid:m.cid,token:m.token};localStorage.setItem(TOK_KEY,JSON.stringify({...paired,at:Date.now()}));label=m.label||'CELULAR';showPad();status('CONECTADO');$('who').textContent=label;buzz(40);break;
 case'hello':if(m.label){label=m.label;$('who').textContent=label;}break;
 case'state':gameState(m);break;
 case'rumble':buzz(Math.min(400,m.ms|0));break;
 case'pong':rtt=Date.now()-m.ts;$('lat').textContent=rtt+' ms';send({t:'rtt',rtt});break;
 case'host-away':status('COMPUTADOR DESCONECTADO…','warn');zero(true);break;
 case'host-back':status('CONECTADO');break;
 case'denied':paired=null;setJoining(null);localStorage.removeItem(TOK_KEY);showPair();lockForm(false);status('O computador recusou este celular. Para tentar de novo, peça um NOVO PIN lá.','err');break;
 case'kicked':case'session-ended':paired=null;setJoining(null);lockForm(false);localStorage.removeItem(TOK_KEY);zero(true);showPair();status('Sessão encerrada. Digite um novo PIN.','err');break;
 case'error':if(m.code!=='resume'){setJoining(null);lockForm(false);}if(m.code==='resume'){paired=null;localStorage.removeItem(TOK_KEY);showPair();if(pendingPin){const p=pendingPin;pendingPin=null;status('CONECTANDO PELO QR CODE…','warn');join(p);break;}}status(m.msg||'Erro','err');break;}}
/* posse de bola vinda do jogo: mine (eu) · team (companheiro) · opp (adversário) · loose (sem dono) · idle (fora da partida) */
const POSS={mine:'⚽ COM A BOLA',team:'TIME COM A BOLA',opp:'SEM A BOLA · DEFENDA',loose:'BOLA DIVIDIDA'};let lastPoss='idle';
function gameState(m){const poss=m.poss||(m.hasBall?'mine':m.attack===false?'opp':'team');/* jogo antigo sem poss: deduz */
 const pad=$('pad'),el=$('poss');
 if(poss==='idle'){$('who').textContent=m.label||label;el.hidden=true;pad.dataset.poss='';labels(true,false);lastPoss=poss;return;}
 $('who').textContent=(m.label||label)+(m.side?(m.side==='home'?' · MANDANTE':' · VISITANTE'):'')+(m.player?' · '+m.player:'');
 el.hidden=false;el.textContent=POSS[poss]||'';pad.dataset.poss=poss;
 if(poss==='mine'&&lastPoss!=='mine')buzz(35);/* pegou a bola */
 lastPoss=poss;labels(m.attack!==false,poss==='mine');}
function labels(attack,hasBall){const L=attack?{pass:'PASSE',shoot:'CHUTE',cross:'CRUZ.',through:'PROF.',tackle:hasBall?'PROTEGER':'MARCA'}:{pass:'PRESSÃO',shoot:'CARRINHO',cross:'DESARME',through:'GOLEIRO',tackle:'DESARME'};
 for(const k in L){const el=document.querySelector(`[data-lbl="${k}"]`);if(el)el.textContent=L[k];}$('pad').classList.toggle('def',!attack);}
/* Tela cheia e horizontal. O navegador só deixa entrar em tela cheia logo depois de um toque (e só em tela cheia deixa travar
   a orientação), então tentamos em todo toque disponível: CONECTAR, o primeiro toque na tela de espera ou no controle.
   Enquanto isso, se o celular estiver em pé, o controle é girado por CSS (html.playing + retrato): já aparece deitado sem toque nenhum. */
const isFs=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
function lockLandscape(){try{const o=screen.orientation;if(o&&o.lock)o.lock('landscape').catch(()=>{});}catch(e){}}
function goFullscreen(){if(!cfg.fs)return;if(isFs()){lockLandscape();return;}const d=document.documentElement,req=d.requestFullscreen||d.webkitRequestFullscreen;if(!req)return;
 try{const p=req.call(d,{navigationUI:'hide'});if(p&&p.then)p.then(lockLandscape,()=>{});else lockLandscape();}catch(e){}}
const portrait=matchMedia('(orientation: portrait)');
const rotated=()=>document.documentElement.classList.contains('playing')&&portrait.matches;
document.addEventListener('pointerdown',e=>{if(e.target.closest&&e.target.closest('input,select,label,#cfg'))return;if(!$('pad').hidden||joining)goFullscreen();},true);
function showPad(){$('pair').hidden=true;$('pad').hidden=false;document.documentElement.classList.add('playing');fit();goFullscreen();}
function showPair(){if(editing)editEnd();$('pad').hidden=true;$('pair').hidden=false;document.documentElement.classList.remove('playing');}
/* botões grandes por padrão; em telas que não comportam (ex.: 667×375), tudo diminui na mesma proporção */
function fit(){const r=rotated(),w=r?innerHeight:innerWidth,h=r?innerWidth:innerHeight;document.documentElement.style.setProperty('--fit',Math.min(1,w/760,h/360).toFixed(3));}
addEventListener('resize',fit);addEventListener('orientationchange',()=>setTimeout(fit,200));
function lockForm(on){$('pin-go').disabled=!!on;$('pin').disabled=!!on;}
function buzz(ms){if(cfg.vib&&navigator.vibrate)try{navigator.vibrate(ms);}catch(e){}}
/* ---------- envio ---------- */
function packet(){return{t:'in',s:++seq,ts:Date.now(),x:+st.x.toFixed(3),y:+st.y.toFixed(3),b:st.b};}
function zero(silent){st.x=0;st.y=0;st.b=0;stickPtr=null;btnPtrs.clear();$('knob').style.transform='';$('stick').classList.remove('active');document.querySelectorAll('.b.on').forEach(b=>b.classList.remove('on'));if(!silent)send(packet());}
let last={x:0,y:0,b:0};
function loop(){requestAnimationFrame(loop);if(!paired||$('pad').hidden)return;const now=performance.now();const changed=st.x!==last.x||st.y!==last.y||st.b!==last.b;
 if((changed&&now-lastSend>15)||now-lastSend>100){send(packet());lastSend=now;last={...st};}}
requestAnimationFrame(loop);
/* envio imediato no próprio evento de toque (não depende do requestAnimationFrame, que o navegador pode desacelerar) */
/* botões e solturas vão na hora, sem esperar o limite de 15 ms do analógico: um toque curto não pode ficar na fila */
function flush(){if(!paired||$('pad').hidden)return;send(packet());lastSend=performance.now();last={...st};}
function pump(){if(!paired||$('pad').hidden)return;const now=performance.now();if(now-lastSend>15){send(packet());lastSend=now;last={...st};}else if(!pump.t)pump.t=setTimeout(()=>{pump.t=0;pump();},16);}
setInterval(()=>{if(paired&&!$('pad').hidden&&performance.now()-lastSend>100){send(packet());lastSend=performance.now();last={...st};}},100);
setInterval(()=>{if(paired)send({t:'ping',ts:Date.now()});},1500);
/* ---------- analógico (captura do ponteiro: não é cancelado por outros toques) ---------- */
const stick=$('stick');
function stickMove(e){const r=stick.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2,R=r.width/2;let dx=(e.clientX-cx)/R,dy=(e.clientY-cy)/R;
 if(rotated()){const sx=dx;dx=dy;dy=-sx;}/* controle girado 90° por CSS: converte o toque da tela para o eixo do controle */
 const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}
 const sc=r.width/(stick.offsetWidth||r.width)||1;$('knob').style.transform=`translate(${dx*R/sc*.62}px,${dy*R/sc*.62}px)`;let mag=Math.min(1,m);if(mag<cfg.dead){st.x=0;st.y=0;pump();return;}const k=Math.min(1,(mag-cfg.dead)/(1-cfg.dead)*cfg.sens)/Math.max(mag,1e-6);let x=dx*k,y=dy*k;
 if(cfg.dpad){const a=Math.round(Math.atan2(y,x)/(Math.PI/4))*(Math.PI/4);x=+Math.cos(a).toFixed(3);y=+Math.sin(a).toFixed(3);}st.x=Math.max(-1,Math.min(1,x));st.y=Math.max(-1,Math.min(1,y));pump();}
stick.addEventListener('pointerdown',e=>{e.preventDefault();if(stickPtr!==null)return;stickPtr=e.pointerId;stick.setPointerCapture(e.pointerId);stick.classList.add('active');stickMove(e);});
stick.addEventListener('pointermove',e=>{if(e.pointerId!==stickPtr)return;e.preventDefault();stickMove(e);});
const stickEnd=e=>{if(e.pointerId!==stickPtr)return;stickPtr=null;st.x=0;st.y=0;$('knob').style.transform='';stick.classList.remove('active');flush();};
stick.addEventListener('pointerup',stickEnd);stick.addEventListener('pointercancel',stickEnd);stick.addEventListener('lostpointercapture',stickEnd);
/* ---------- botões ---------- */
document.querySelectorAll('[data-b]').forEach(el=>{const k=el.dataset.b,bit=1<<BTN.indexOf(k);
 el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);btnPtrs.set(e.pointerId,k);st.b|=bit;el.classList.add('on');flush();buzz(12);});
 const up=e=>{if(!btnPtrs.has(e.pointerId))return;btnPtrs.delete(e.pointerId);if(![...btnPtrs.values()].includes(k)){st.b&=~bit;el.classList.remove('on');}flush();};
 el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);});
/* sem rolagem, zoom ou seleção durante o jogo */
['touchmove','gesturestart','contextmenu','dblclick'].forEach(t=>document.addEventListener(t,e=>{if(!$('pad').hidden)e.preventDefault();},{passive:false}));
document.addEventListener('visibilitychange',()=>{if(document.hidden)zero(false);});/* 'blur' não zera: com o dedo na tela, interrupções reais do sistema já chegam como pointercancel/visibilitychange */window.addEventListener('pagehide',()=>zero(false));
/* ---------- pareamento ---------- */
$('pin').addEventListener('input',e=>{const v=e.target.value.replace(/\D/g,'').slice(0,6);e.target.value=v.length>3?v.slice(0,3)+' '+v.slice(3):v;});
function sendJoin(pin){send({t:'join',pin,name:$('name').value.trim()||'Celular',dev:deviceId});}
function join(pin){if(joining&&joining.pin===pin)return;/* já pedido: não pede de novo */stopped=false;setJoining({pin});lockForm(true);localStorage.setItem('trs26-pad-name',$('name').value.trim()||'Celular');connect(()=>sendJoin(pin));}
$('pin-form').addEventListener('submit',e=>{e.preventDefault();const pin=$('pin').value.replace(/\D/g,'');if(pin.length!==6){status('O PIN tem 6 dígitos.','err');return;}goFullscreen();join(pin);});
$('name').value=localStorage.getItem('trs26-pad-name')||'';
/* QR code do computador: abre /controller/#pin=123456. O fragmento (#) não vai ao servidor nem fica no histórico:
   lemos o PIN e limpamos a URL. A autorização no computador continua obrigatória. */
function takeHashPin(){const p=((location.hash||'').match(/[#&]pin=(\d{6})(?:&|$)/)||[])[1]||null;
 if(p){try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}if(!paired)$('pin').value=p.slice(0,3)+' '+p.slice(3);}return p;}
const qrPin=takeHashPin();
/* QR lido de novo com a página já aberta: o navegador só troca o #, sem recarregar. Já conectado: ignora; senão segue o
   mesmo caminho (join não repete um pedido já feito com esse PIN, e o servidor reaproveita o pedido deste aparelho). */
window.addEventListener('hashchange',()=>{const p=takeHashPin();if(p&&!paired&&!(joining&&joining.pin===p)){status('CONECTANDO PELO QR CODE…','warn');join(p);}});
/* aba recarregada enquanto esperava a autorização: retoma o mesmo pedido (o PIN vale 10 minutos) */
const savedJoin=(()=>{try{const j=JSON.parse(sessionStorage.getItem(JOIN_KEY)||'null');return j&&/^\d{6}$/.test(j.pin)&&Date.now()-j.at<10*60e3?j.pin:null;}catch(e){return null;}})();
if(!qrPin&&savedJoin)$('pin').value=savedJoin.slice(0,3)+' '+savedJoin.slice(3);
let pendingPin=qrPin||savedJoin;/* PIN à espera: usado se não houver token deste aparelho ou se a reconexão for recusada */
/* reconexão automática com o token deste aparelho */
let resuming=false;
try{const t=JSON.parse(localStorage.getItem(TOK_KEY)||'null');if(t&&Date.now()-t.at<3600e3){paired={sid:t.sid,cid:t.cid,token:t.token};resuming=true;status('RECONECTANDO…','warn');connect(()=>send({t:'resume',...paired}));}}catch(e){}
if(pendingPin&&!resuming){const p=pendingPin;pendingPin=null;status('CONECTANDO PELO QR CODE…','warn');join(p);}
/* ---------- configurações ---------- */
$('gear').onclick=()=>{$('cfg').hidden=false;zero(false);};$('cfg-close').onclick=()=>{$('cfg').hidden=true;};$('cfg-reset').onclick=()=>{cfg={...DEF};applyCfg();};
$('cfg-leave').onclick=()=>{paired=null;localStorage.removeItem(TOK_KEY);zero(false);try{ws&&ws.close();}catch(e){}$('cfg').hidden=true;showPair();status('Desconectado.');};
document.querySelectorAll('[data-cfg]').forEach(i=>i.addEventListener('input',()=>{const k=i.dataset.cfg;cfg[k]=i.type==='checkbox'?i.checked:+i.value;applyCfg();}));
applyCfg();
/* ---------- HUD personalizado ----------
   Cada controle (analógico e botões) pode ser arrastado, redimensionado e ocultado. As posições ficam em % do controle deitado,
   então valem com o celular girado por CSS ou na horizontal de verdade, e em telas de tamanhos diferentes. */
const LAYOUT_KEY='trs26-pad-layout';
const padEl=$('pad');
const ctrls=()=>[...padEl.querySelectorAll('#stick,[data-b]')];
const keyOf=el=>el.dataset.b||'stick';
let layout=null,editing=false,sel=null,drag=null,pristine=false;
try{const l=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');if(l&&l.v===1&&l.items)layout=l;}catch(e){}
function applyLayout(){padEl.classList.toggle('custom',!!layout);
 for(const el of ctrls()){const it=layout&&layout.items[keyOf(el)];
  if(it){el.style.setProperty('--x',it.x);el.style.setProperty('--y',it.y);el.style.setProperty('--s',it.s);}else['--x','--y','--s'].forEach(p=>el.style.removeProperty(p));
  el.classList.toggle('hud-hidden',!!(it&&it.h));}}
function saveLayout(){try{if(layout)localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout));else localStorage.removeItem(LAYOUT_KEY);}catch(e){}}
/* ponto da tela → % do controle deitado (desfaz o giro de 90° do modo retrato) */
function toLocal(sx,sy){const w=padEl.offsetWidth||1,h=padEl.offsetHeight||1;let lx=sx,ly=sy;if(rotated()){lx=sy;ly=innerWidth-sx;}return{x:lx/w*100,y:ly/h*100};}
/* posições atuais (layout padrão) como ponto de partida */
function captureLayout(){const items={};for(const el of ctrls()){const r=el.getBoundingClientRect();const c=toLocal(r.left+r.width/2,r.top+r.height/2);items[keyOf(el)]={x:+c.x.toFixed(2),y:+c.y.toFixed(2),s:1,h:false};}return{v:1,items};}
function select(el){sel=el;ctrls().forEach(c=>c.classList.toggle('hud-sel',c===el));const it=el&&layout.items[keyOf(el)];
 $('he-size').textContent=it?Math.round(it.s*100)+'%':'—';$('he-hide').textContent=it&&it.h?'MOSTRAR':'OCULTAR';['he-minus','he-plus','he-hide'].forEach(id=>$(id).disabled=!el);}
function editStart(){zero(false);pristine=!layout;if(!layout)layout=captureLayout();applyLayout();editing=true;padEl.classList.add('editing');$('hud-edit').hidden=false;select(null);}
function editEnd(){editing=false;drag=null;if(pristine)layout=null;/* nada mudou: continua no layout padrão, que se adapta à tela */
 padEl.classList.remove('editing');$('hud-edit').hidden=true;select(null);applyLayout();saveLayout();}
/* no modo de edição, os toques movem os controles e nada é enviado ao jogo (captura antes dos botões) */
padEl.addEventListener('pointerdown',e=>{if(!editing||e.target.closest('#hud-edit'))return;e.stopPropagation();e.preventDefault();
 const el=e.target.closest('#stick,[data-b]');select(el);if(!el)return;const it=layout.items[keyOf(el)],p=toLocal(e.clientX,e.clientY);drag={id:e.pointerId,el,ox:it.x-p.x,oy:it.y-p.y};try{padEl.setPointerCapture(e.pointerId);}catch(x){}},true);
padEl.addEventListener('pointermove',e=>{if(!editing||!drag||e.pointerId!==drag.id)return;e.stopPropagation();const p=toLocal(e.clientX,e.clientY),it=layout.items[keyOf(drag.el)];
 it.x=+Math.max(0,Math.min(100,p.x+drag.ox)).toFixed(2);it.y=+Math.max(0,Math.min(100,p.y+drag.oy)).toFixed(2);pristine=false;applyLayout();},true);
['pointerup','pointercancel'].forEach(t=>padEl.addEventListener(t,e=>{if(!editing)return;e.stopPropagation();if(drag&&e.pointerId===drag.id)drag=null;},true));
const resize=d=>{if(!sel)return;const it=layout.items[keyOf(sel)];it.s=+Math.max(.5,Math.min(2,it.s+d)).toFixed(2);pristine=false;applyLayout();select(sel);};
$('he-minus').onclick=()=>resize(-.1);$('he-plus').onclick=()=>resize(.1);
$('he-hide').onclick=()=>{if(!sel)return;const it=layout.items[keyOf(sel)];it.h=!it.h;pristine=false;applyLayout();select(sel);};
$('he-reset').onclick=()=>{layout=null;applyLayout();layout=captureLayout();applyLayout();pristine=true;select(null);};
$('he-done').onclick=editEnd;
$('cfg-hud').onclick=()=>{$('cfg').hidden=true;editStart();};
applyLayout();
window.TRSPad={state:()=>({...st,seq,paired:!!paired}),zero,layout:()=>layout&&JSON.parse(JSON.stringify(layout)),editing:()=>editing};/* usado pelos testes automatizados */
})();
