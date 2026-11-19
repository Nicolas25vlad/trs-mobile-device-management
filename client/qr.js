/* TRS · controle no celular — gerador de QR code sem dependências (ISO/IEC 18004).
   Modo byte (UTF-8), correção de erros nível M (~15%), versões 1 a 10 (até 213 bytes: sobra para um endereço da rede local).
   MD.QR.matrix(texto) → {size, version, mask, dark(x,y)}; MD.QR.svg(texto, {quiet}) → string <svg> (preto no branco).
   Funciona no navegador (window.MD) e no Node (globalThis.MD) para os testes. */
(function(MD){
'use strict';
const Q=MD.QR={};
/* nível M, versões 1..10: códigos de correção por bloco e número de blocos */
const ECC_PER_BLOCK=[0,10,16,26,18,24,16,18,22,22,26];
const BLOCKS=[0,1,1,1,2,2,4,4,4,5,5];
const MAX_VER=10,FMT_M=0;/* bits de formato do nível M = 00 */
/* ---------- GF(256), polinômio 0x11D ---------- */
function gmul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x;}return z;}
function rsDivisor(deg){const r=new Array(deg).fill(0);r[deg-1]=1;let root=1;
 for(let i=0;i<deg;i++){for(let j=0;j<deg;j++){r[j]=gmul(r[j],root);if(j+1<deg)r[j]^=r[j+1];}root=gmul(root,2);}return r;}
function rsRemainder(data,div){const r=new Array(div.length).fill(0);
 for(const b of data){const f=b^r.shift();r.push(0);for(let i=0;i<div.length;i++)r[i]^=gmul(div[i],f);}return r;}
/* ---------- capacidade ---------- */
function rawModules(v){let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36;}return r;}
const totalCodewords=v=>Math.floor(rawModules(v)/8);
const dataCodewords=v=>totalCodewords(v)-ECC_PER_BLOCK[v]*BLOCKS[v];
function alignPos(v){if(v===1)return[];const n=Math.floor(v/7)+2;const step=Math.ceil((v*4+4)/(n*2-2))*2;const out=[6];for(let p=v*4+10;out.length<n;p-=step)out.splice(1,0,p);return out;}
function utf8(s){if(typeof TextEncoder!=='undefined')return[...new TextEncoder().encode(s)];return[...unescape(encodeURIComponent(s))].map(c=>c.charCodeAt(0));}
/* ---------- dados + correção, intercalados ---------- */
function codewords(bytes,v){
 const bits=[];const put=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1);};
 put(4,4);put(bytes.length,v<10?8:16);for(const b of bytes)put(b,8);
 const cap=dataCodewords(v)*8;put(0,Math.min(4,cap-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=b<<1|bits[i+j];data.push(b);}
 for(let pad=0xEC;data.length<dataCodewords(v);pad^=0xEC^0x11)data.push(pad);
 const nb=BLOCKS[v],ecc=ECC_PER_BLOCK[v],total=totalCodewords(v);const nShort=nb-total%nb,shortLen=Math.floor(total/nb);
 const div=rsDivisor(ecc);const blocks=[];
 for(let i=0,k=0;i<nb;i++){const len=shortLen-ecc+(i<nShort?0:1);const d=data.slice(k,k+len);k+=len;blocks.push({d,e:rsRemainder(d,div)});}
 const out=[];const maxD=shortLen-ecc+1;
 for(let i=0;i<maxD;i++)for(const b of blocks)if(i<b.d.length)out.push(b.d[i]);
 for(let i=0;i<ecc;i++)for(const b of blocks)out.push(b.e[i]);
 return out;}
/* ---------- matriz ---------- */
function build(v,cw){const n=v*4+17;const M=[],F=[];for(let y=0;y<n;y++){M.push(new Uint8Array(n));F.push(new Uint8Array(n));}
 const set=(x,y,d)=>{M[y][x]=d?1:0;F[y][x]=1;};
 for(let i=0;i<n;i++){set(6,i,i%2===0);set(i,6,i%2===0);}/* temporização */
 for(const [cx,cy] of [[3,3],[n-4,3],[3,n-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=n||y>=n)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4);}/* localizadores + separadores */
 const ap=alignPos(v);for(let i=0;i<ap.length;i++)for(let j=0;j<ap.length;j++){if(i===0&&j===0||i===0&&j===ap.length-1||i===ap.length-1&&j===0)continue;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ap[i]+dx,ap[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}/* alinhamento */
 drawFormat(M,F,n,0);/* reserva a área do formato (redesenhada com a máscara escolhida) */
 if(v>=7){let r=v;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const bits=v<<12|r;
  for(let i=0;i<18;i++){const b=(bits>>>i)&1,a=n-11+i%3,c=Math.floor(i/3);set(a,c,b);set(c,a,b);}}/* versão */
 let i=0;const nbits=cw.length*8;/* dados em zigue-zague, de baixo para cima, pares de colunas da direita para a esquerda */
 for(let right=n-1;right>=1;right-=2){if(right===6)right=5;
  for(let vert=0;vert<n;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?n-1-vert:vert;
   if(!F[y][x]&&i<nbits){M[y][x]=(cw[i>>>3]>>>(7-(i&7)))&1;i++;}}}
 return{M,F,n};}
function drawFormat(M,F,n,mask){const data=FMT_M<<3|mask;let r=data;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const bits=(data<<10|r)^0x5412;
 const set=(x,y,d)=>{M[y][x]=d?1:0;F[y][x]=1;};const b=i=>(bits>>>i)&1;
 for(let i=0;i<=5;i++)set(8,i,b(i));set(8,7,b(6));set(8,8,b(7));set(7,8,b(8));for(let i=9;i<15;i++)set(14-i,8,b(i));
 for(let i=0;i<8;i++)set(n-1-i,8,b(i));for(let i=8;i<15;i++)set(8,n-15+i,b(i));set(8,n-8,1);/* módulo escuro fixo */}
const MASKS=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,
 (x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
function applyMask(M,F,n,k){const f=MASKS[k];for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(!F[y][x]&&f(x,y))M[y][x]^=1;}
/* penalidade da norma (N1 sequências, N2 blocos 2×2, N3 padrão parecido com localizador, N4 equilíbrio claro/escuro) */
function penalty(M,n){let p=0;const line=get=>{let run=1;for(let i=1;i<n;i++){if(get(i)===get(i-1)){run++;if(run===5)p+=3;else if(run>5)p++;}else run=1;}
  for(let i=0;i+11<=n;i++){let a=true,b=true;const P=[1,0,1,1,1,0,1,0,0,0,0];for(let j=0;j<11;j++){const v=get(i+j);if(v!==P[j])a=false;if(v!==P[10-j])b=false;}if(a)p+=40;if(b)p+=40;}};
 for(let y=0;y<n;y++)line(x=>M[y][x]);for(let x=0;x<n;x++)line(y=>M[y][x]);
 for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){const c=M[y][x];if(c===M[y][x+1]&&c===M[y+1][x]&&c===M[y+1][x+1])p+=3;}
 let dark=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++)dark+=M[y][x];const t=n*n;p+=Math.ceil(Math.abs(dark*20-t*10)/t-1)*10;return p;}
Q.matrix=function(text){const bytes=utf8(String(text));let v=1;
 while(v<=MAX_VER&&4+(v<10?8:16)+bytes.length*8>dataCodewords(v)*8)v++;
 if(v>MAX_VER)throw new Error('texto longo demais para o QR ('+bytes.length+' bytes; máximo 213)');
 const cw=codewords(bytes,v);let best=null;
 for(let k=0;k<8;k++){const g=build(v,cw);applyMask(g.M,g.F,g.n,k);drawFormat(g.M,g.F,g.n,k);const sc=penalty(g.M,g.n);if(!best||sc<best.sc)best={sc,k,M:g.M,n:g.n};}
 const M=best.M;return{size:best.n,version:v,mask:best.k,dark:(x,y)=>x>=0&&y>=0&&x<best.n&&y<best.n&&M[y][x]===1};};
Q.svg=function(text,opt){opt=opt||{};const q=opt.quiet==null?4:opt.quiet;const m=Q.matrix(text);const w=m.size+q*2;let d='';
 for(let y=0;y<m.size;y++)for(let x=0;x<m.size;x++)if(m.dark(x,y))d+=`M${x+q} ${y+q}h1v1h-1z`;
 const label=opt.label?String(opt.label).replace(/[<>&"]/g,''):'QR code';
 return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${w}" height="${w}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;};
})(typeof window!=='undefined'?(window.MD=window.MD||{}):(globalThis.MD=globalThis.MD||{}));
