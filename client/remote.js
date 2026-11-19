/* TRS · controle no celular — CLIENTE do lado do jogo (anfitrião). Vem do repo trs-mobile-device-management, servido em /mobile/remote.js.
   Fala com o server/server.js deste repo por WebSocket (mesma origem http). O servidor só faz pareamento e repasse;
   a lógica de futebol nunca vê a rede: cada celular vira um dispositivo de MD.Input igual a um controle físico.
   Segurança: PIN temporário + autorização do anfitrião + token por controle; pacotes fora de ordem ou velhos são descartados. */
(function(MD){
'use strict';
const R=MD.Remote={session:null,controllers:new Map(),status:'idle',ws:null,onChange:null,error:''};
const BTN=['pass','shoot','cross','through','sprint','switch','skill','tackle','support','pause'];R.BTN=BTN;
const changed=()=>{try{R.onChange&&R.onChange();}catch(e){}};
R.available=()=>typeof location!=='undefined'&&(location.protocol==='http:'||location.protocol==='https:')&&typeof WebSocket!=='undefined';
R.init=function(){if(!R.available())return;/* reconecta uma sessão anterior desta aba */try{const s=JSON.parse(sessionStorage.getItem('trs26-host')||'null');if(s&&s.expires>Date.now()){R.session=s;R.connect(()=>R.send({t:'host-resume',id:s.id,hostToken:s.hostToken}));}}catch(e){}};
R.connect=function(then){if(R.ws&&R.ws.readyState<=1){if(then)(R.ws.readyState===1?then():R.pendingThen=then);return;}R.status='connecting';changed();
 const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';let ws;try{ws=new WebSocket(url);}catch(e){R.status='error';R.error=e.message;changed();return;}R.ws=ws;R.pendingThen=then;
 ws.onopen=()=>{R.status='open';R.retry=0;const f=R.pendingThen;R.pendingThen=null;if(f)f();changed();R.pingT=setInterval(()=>R.send({t:'ping',ts:Date.now()}),2000);};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(err){return;}R.handle(m);};
 ws.onclose=()=>{clearInterval(R.pingT);R.status=R.session?'reconnecting':'idle';for(const c of R.controllers.values()){if(c.state==='connected'){c.state='reconnecting';}MD.Input.remoteGone('rc-'+c.cid);}changed();
  if(R.session&&R.session.expires>Date.now()){R.retry=(R.retry||0)+1;setTimeout(()=>R.connect(()=>R.send({t:'host-resume',id:R.session.id,hostToken:R.session.hostToken})),Math.min(5000,500*R.retry));}};
 ws.onerror=()=>{R.status='error';R.error='servidor não encontrado (rode node server/server.js)';changed();};};
R.send=o=>{if(R.ws&&R.ws.readyState===1)R.ws.send(JSON.stringify(o));};
R.createSession=function(){R.connect(()=>R.send({t:'host-create'}));};
R.closeSession=function(){R.send({t:'host-close'});R.session=null;sessionStorage.removeItem('trs26-host');for(const c of R.controllers.values())MD.Input.remoteGone('rc-'+c.cid);R.controllers.clear();changed();};
R.approve=(cid,ok)=>{R.send({t:ok?'approve':'deny',cid});const c=R.controllers.get(cid);if(c&&!ok){c.state='gone';}changed();};
R.kick=cid=>{R.send({t:'kick',cid});const c=R.controllers.get(cid);if(c)c.state='gone';MD.Input.remoteGone('rc-'+cid);changed();};
R.toCtrl=(cid,msg)=>R.send({t:'to-ctrl',cid,msg});
R.dropControllers=function(){for(const c of R.controllers.values())MD.Input.remoteGone('rc-'+c.cid);R.controllers.clear();R.lastState={};};
/* QR code de pareamento: endereço do controle com o PIN no fragmento (#), que o navegador não envia ao servidor.
   i escolhe o endereço da rede local (o servidor manda o mais provável de ser o Wi-Fi primeiro). */
R.joinUrl=function(i){const s=R.session;if(!s||!s.urls||!s.urls.length)return'';const u=s.urls[Math.max(0,Math.min(s.urls.length-1,i|0))];return u+'#pin='+s.pin;};
R.qrSvg=function(i){const u=R.joinUrl(i);if(!u||!MD.QR)return'';try{return MD.QR.svg(u,{label:'QR code para conectar o celular'});}catch(e){return'';}};
R.handle=function(m){switch(m.t){
 case'session':if(R.session&&R.session.id!==m.id)R.dropControllers();/* sessão nova (NOVO PIN): os celulares da anterior já foram desconectados pelo servidor */
  R.session={id:m.id,pin:m.pin,hostToken:m.hostToken,expires:m.expires,urls:m.urls||[]};sessionStorage.setItem('trs26-host',JSON.stringify(R.session));changed();break;
 case'session-ended':R.session=null;sessionStorage.removeItem('trs26-host');R.dropControllers();changed();break;
 case'pair-request':{const n=[...R.controllers.values()].filter(c=>c.state!=='gone').length;R.controllers.set(m.cid,{cid:m.cid,name:m.name||'Celular',state:'pending',label:'CELULAR '+(n+1),seq:-1});changed();MD.App&&MD.App.toast&&MD.App.toast('Celular quer se conectar: autorize em Controle Virtual.');break;}
 case'ctrl-state':{const c=R.controllers.get(m.cid)||{cid:m.cid,name:m.name||'Celular',label:m.label||'CELULAR',seq:-1};c.state=m.state;if(m.label)c.label=m.label;R.controllers.set(m.cid,c);if(m.state!=='connected')MD.Input.remoteGone('rc-'+m.cid);else{c.seq=-1;delete R.lastState[m.cid];/* (re)conectou: reenviar o estado */R.toCtrl(m.cid,{t:'hello',label:c.label});}changed();break;}
 case'ctrl-in':{const c=R.controllers.get(m.cid);if(!c||c.state!=='connected')return;if(typeof m.s!=='number'||m.s<=c.seq)return;/* descarta pacotes antigos/duplicados */c.seq=m.s;
  const x=Math.max(-1,Math.min(1,+m.x||0)),y=Math.max(-1,Math.min(1,+m.y||0));const b=m.b|0;const pkt={x,y};BTN.forEach((k,i)=>pkt[k]=!!(b&(1<<i)));
  MD.Input.remoteUpdate('rc-'+m.cid,c.label,pkt);const d=MD.Input.device('rc-'+m.cid);if(d&&!d.sendRumble)d.sendRumble=ms=>R.toCtrl(m.cid,{t:'rumble',ms});break;}
 case'ctrl-rtt':{const c=R.controllers.get(m.cid);if(c){c.rtt=m.rtt;if(MD.App&&MD.App.screen==='remote')changed();}break;}
 case'pong':R.rtt=Date.now()-m.ts;break;
 case'error':R.error=m.msg;if(m.code==='session')R.session=null;changed();break;}};
/* Estado de jogo enviado ao celular: posse de bola e rótulos dos botões.
   poss: 'mine' (eu com a bola) · 'team' (companheiro) · 'opp' (adversário) · 'loose' (bola sem dono) · 'idle' (fora da partida).
   Verificado a cada 50 ms, mas só enviado quando muda: a posse aparece no celular quase na hora, sem tráfego extra. */
R.lastState={};
R.possession=function(S,h){const o=S.w.ball.owner,p=h.H.player;if(o&&p&&o===p)return'mine';if(o)return o.team===h.H.ti?'team':'opp';
 /* bola parada (saída, lateral, escanteio...): quem cobra está com a bola, mesmo sem dono ainda */
 const rs=S.w.restart;if(rs){if(rs.taker&&p&&rs.taker===p)return'mine';const t=rs.taker?rs.taker.team:rs.team;if(t===0||t===1)return t===h.H.ti?'team':'opp';}
 return'loose';};
R.pushState=function(){if(!R.session)return;const S=MD.Play&&MD.Play.active&&MD.Play.active()?MD.Play.state():null;const seen=new Set();
 if(S)for(const h of S.humans){if(!h.device.startsWith('rc-'))continue;const cid=h.device.slice(3);seen.add(cid);const p=h.H.player;const poss=R.possession(S,h);
  const attack=poss==='mine'||poss==='team'||poss==='loose'&&S.w.ball.lastTeam===h.H.ti;
  const key=[h.label,h.side,poss,attack,p?p.id:''].join('|');if(R.lastState[cid]===key)continue;R.lastState[cid]=key;
  R.toCtrl(cid,{t:'state',label:h.label,side:h.side,poss,hasBall:poss==='mine',attack,player:p?p.name:''});}
 /* fora da partida (menu, intervalo de telas): avisa uma vez para o celular apagar o indicador */
 for(const c of R.controllers.values()){if(c.state!=='connected'||seen.has(c.cid)||R.lastState[c.cid]==='idle')continue;R.lastState[c.cid]='idle';R.toCtrl(c.cid,{t:'state',label:c.label,poss:'idle'});}};
setInterval(()=>{try{R.pushState();}catch(e){}},50);
})(window.MD=window.MD||{});
