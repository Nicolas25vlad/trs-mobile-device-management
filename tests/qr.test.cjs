'use strict';
/* TRS · controle no celular — testes do gerador de QR code (client/qr.js), sem dependências.
   As matrizes de referência abaixo foram decodificadas com sucesso pelo jsQR 1.4.0 (todas as versões 1–10 e as 8 máscaras
   também foram conferidas assim, inclusive com módulos trocados). Aqui verificamos a estrutura da norma e que o resultado não muda. */
const assert=require('node:assert/strict');const crypto=require('node:crypto');
globalThis.MD={};require('../client/qr.js');const Q=globalThis.MD.QR;
let checks=0;const ok=(c,msg)=>{assert.ok(c,msg);checks++;console.log('  ✓ '+msg);};
const bits=m=>{let s='';for(let y=0;y<m.size;y++)for(let x=0;x<m.size;x++)s+=m.dark(x,y)?1:0;return s;};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
console.log('Versão e tamanho:');
ok(Q.matrix('a'.repeat(14)).version===1&&Q.matrix('a'.repeat(15)).version===2,'versão 1 aceita até 14 bytes (nível M); 15 bytes passa para a versão 2');
ok(Q.matrix('a'.repeat(62)).version===4&&Q.matrix('a'.repeat(63)).version===5,'versão 4 aceita até 62 bytes');
ok(Q.matrix('a'.repeat(213)).version===10,'versão 10 aceita 213 bytes');
assert.throws(()=>Q.matrix('a'.repeat(214)));checks++;console.log('  ✓ texto de 214 bytes é recusado com erro claro');
ok([1,2,4,7,10].every(v=>{const lens={1:5,2:20,4:50,7:110,10:200};const m=Q.matrix('b'.repeat(lens[v]));return m.version===v&&m.size===4*v+17;}),'tamanho da matriz é 4·versão+17');
ok(Q.matrix('ação').version===1,'texto UTF-8 (acentos) é aceito');
console.log('Estrutura (ISO/IEC 18004):');
const url='http://192.168.0.10:8080/controller/#pin=123456';const m=Q.matrix(url);const n=m.size;
const finder=(cx,cy)=>{for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));if(m.dark(cx+dx,cy+dy)!==(d!==2))return false;}return true;};
ok(finder(3,3)&&finder(n-4,3)&&finder(3,n-4),'três padrões localizadores nos cantos');
ok([...Array(7)].every((_,i)=>!m.dark(7,i)&&!m.dark(i,7)&&!m.dark(n-8,i)&&!m.dark(i,n-8)),'separadores claros em volta dos localizadores');
let timing=true;for(let i=8;i<n-8;i++)if(m.dark(i,6)!==(i%2===0)||m.dark(6,i)!==(i%2===0))timing=false;ok(timing,'linhas de temporização alternadas');
ok(m.dark(8,n-8),'módulo escuro fixo');
/* formato: as duas cópias são iguais e decodificam para nível M + máscara escolhida */
const f1=[];for(let i=0;i<=5;i++)f1.push(m.dark(8,i));f1.push(m.dark(8,7),m.dark(8,8),m.dark(7,8));for(let i=9;i<15;i++)f1.push(m.dark(14-i,8));
const f2=[];for(let i=0;i<8;i++)f2.push(m.dark(n-1-i,8));for(let i=8;i<15;i++)f2.push(m.dark(8,n-15+i));
const fv=f1.reduce((a,b,i)=>a|(b?1:0)<<i,0);ok(fv===f2.reduce((a,b,i)=>a|(b?1:0)<<i,0),'as duas cópias da informação de formato são iguais');
const raw=fv^0x5412;ok((raw>>>13)===0&&((raw>>>10)&7)===m.mask,'formato indica nível M e a máscara usada');
let r=raw>>>10;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);ok((r&0x3ff)===(raw&0x3ff),'código BCH do formato confere');
const v7=Q.matrix('c'.repeat(110));let vb=0;for(let i=0;i<18;i++)if(v7.dark(v7.size-11+i%3,Math.floor(i/3)))vb|=1<<i;ok(vb>>>12===7,'versão ≥7 grava a informação de versão');
console.log('Referências decodificadas pelo jsQR (não pode mudar sem nova conferência):');
ok(m.version===4&&m.mask===2&&sha(bits(m))==='cd597f8e79f83733d56375d798ff9425b818cee3cc3f7aee765573a3bca4ff04','URL do controle com PIN: versão 4, máscara 2, matriz idêntica');
const t=Q.matrix('TRS');ok(t.version===1&&t.mask===0&&sha(bits(t))==='06cfbb60abdcd93188eece1722a2174b162cd8ca9e9b55808533b536cec34b2f','"TRS": versão 1, máscara 0, matriz idêntica');
console.log('SVG:');
const svg=Q.svg(url,{label:'teste <b>'});ok(svg.startsWith('<svg')&&svg.includes(`viewBox="0 0 ${n+8} ${n+8}"`),'SVG com zona de silêncio de 4 módulos');
ok(svg.includes('fill="#fff"')&&svg.includes('fill="#000"')&&!svg.includes('<b>'),'preto no branco; rótulo escapado');
ok((svg.match(/h1v1h-1z/g)||[]).length===bits(m).split('').filter(c=>c==='1').length,'um quadrado por módulo escuro');
console.log(`QR TEST PASS (${checks} verificações)`);
