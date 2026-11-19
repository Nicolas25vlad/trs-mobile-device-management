'use strict';
/* TRS · controle no celular — testes do cliente do jogo (client/remote.js) sem navegador:
   posse de bola enviada ao celular (mine/team/opp/loose/idle), só quando muda, e reenvio ao reconectar. */
const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let checks=0;const ok=(c,msg)=>{assert.ok(c,msg);checks++;console.log('  ✓ '+msg);};
const sent=[];let S=null;
const sb={console,Math,Date,JSON,Object,Array,Number,String,Set,Map,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,
 sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{protocol:'file:'}};
sb.window=sb;sb.MD={Input:{remoteGone(){},remoteUpdate(){},device:()=>null},Play:{active:()=>!!S,state:()=>S}};vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','client','remote.js'),'utf8'),sb,{filename:'remote.js'});
const R=sb.MD.Remote;R.session={id:'s'};R.toCtrl=(cid,msg)=>sent.push({cid,...msg});
R.controllers.set('c1',{cid:'c1',state:'connected',label:'CELULAR 1'});
const me={id:'p9',name:'Yuri',team:0},mate={id:'p2',team:0},rival={id:'q4',team:1};
const human={device:'rc-c1',label:'P1',side:'home',H:{player:me,ti:0}};
const world=(owner,lastTeam,restart)=>({humans:[human],w:{ball:{owner,lastTeam:lastTeam??-1},restart:restart||null}});
const last=()=>sent[sent.length-1];
console.log('Posse de bola:');
S=world(null,-1,{type:'kickoff',team:0,taker:me});R.pushState();ok(last().poss==='mine'&&last().attack&&last().hasBall,'saída de bola cobrada por mim: COM A BOLA, rótulos de ataque');
S=world(null,-1,{type:'throw',team:0,taker:mate});R.pushState();ok(last().poss==='team'&&last().attack,'lateral do meu time cobrado por companheiro: time com a bola');
S=world(null,-1,{type:'corner',team:1});R.pushState();ok(last().poss==='opp'&&last().attack===false,'escanteio do adversário (cobrador ainda não definido): defender');
S=world(me,0);R.pushState();ok(last().poss==='mine'&&last().player==='Yuri','eu com a bola');
S=world(mate,0);R.pushState();ok(last().poss==='team'&&last().attack===true,'companheiro com a bola');
S=world(rival,1);R.pushState();ok(last().poss==='opp'&&last().attack===false&&!last().hasBall,'adversário com a bola');
S=world(null,0);R.pushState();ok(last().poss==='loose'&&last().attack===true,'bola sem dono, último toque nosso: dividida, ainda atacando');
S=world(null,1);R.pushState();ok(last().poss==='loose'&&last().attack===false,'bola sem dono, último toque deles: dividida, defendendo');
console.log('Envio:');
const n=sent.length;R.pushState();R.pushState();ok(sent.length===n,'sem mudança, nada é enviado de novo');
S=null;R.pushState();ok(last().poss==='idle','fora da partida: avisa o celular para apagar o indicador');
R.pushState();ok(sent.length===n+1,'aviso de fora da partida vai uma vez só');
S=world(me,0);R.pushState();const k=sent.length;
R.handle({t:'ctrl-state',cid:'c1',state:'connected',label:'CELULAR 1'});R.pushState();
ok(sent.slice(k).some(m=>m.t==='state'&&m.poss==='mine'),'celular que reconecta recebe o estado de novo');
R.handle({t:'session-ended'});ok(R.controllers.size===0&&Object.keys(R.lastState).length===0,'fim da sessão limpa controles e estado');
console.log(`REMOTE TEST PASS (${checks} verificações)`);
