'use strict';
/* FGC 2026 Scouting — Map：全場示意圖 + 可拖曳的機器人圖標，賽前對著它講站位用。
   場地幾何照官方圖面 FG26_F（2026-05-07 版）：7000 × 7000 mm，圖裡的座標一律是場地毫米，
   要畫的時候才換算成 viewBox。圖標位置也存毫米，所以換手機、轉螢幕、放大縮小都對得上，
   存成像素就會跟著螢幕寬度跑掉。 */

const MP = {
  F: 7000,                                   // 場地邊長（mm）
  VB: {x:-760, y:-150, w:8520, h:7300},      // 左右多留的是聯盟站（在場地外）
  MAX: 3,                                    // 每一方最多三台，規則寫死的
  PAD: 250,                                  // 圖標中心離護欄至少這麼遠；等於出發區的中線，夾限才不會把剛擺好的機器人推開
  /* 出發位置：機器人開賽時待在自己那側的 REGIONAL ZONE（貼著護欄的 500 mm 寬長條）*/
  START: {r:[[250,1300],[250,2800],[250,4300]], b:[[6750,1300],[6750,2800],[6750,4300]]}
};
const MP_SIDES = ['r','b'];
const MP_LBL = {r:'R', b:'B'};

/* ---------- 資料 ---------- */
/* 存在 cfg 底下：cfg 整包會跟著同步走（server 端以 cfg.ts 比新舊），隊上每支手機看到的是同一張圖。
   兩台同時拖會是「後存的贏」，跟 cfg 裡其他東西一樣，討論站位夠用了。 */
function mapState(){
  const m = DB.cfg.map;
  MP_SIDES.forEach(s=>{
    if(!Array.isArray(m[s])) m[s]=[];
    m[s]=m[s].slice(0,MP.MAX).map((r,i)=>{                 // 同步回來的資料可能是別的版本寫的
      const d=mapStart(s,i), o=(r&&typeof r==='object')?r:{};
      o.x=Number.isFinite(+o.x)?mapClamp(+o.x):d.x;        // 沒有座標就放回出發區，不要讓圖標消失
      o.y=Number.isFinite(+o.y)?mapClamp(+o.y):d.y;
      o.slug=typeof o.slug==='string'?o.slug:'';
      return o;
    });
  });
  return m;
}
function mapClamp(v){ return Math.max(MP.PAD, Math.min(MP.F-MP.PAD, Math.round(v))); }   // 場地是正方形，x/y 同一條夾限
function mapStart(side,i){ const p=MP.START[side][i%MP.MAX]; return {x:p[0],y:p[1]}; }

/* ---------- 場地 ---------- */
/* 元件座標（mm，y 從放滅火器的那一邊往下算）。數字是直接從官方圖面 p2 量的：
   以出發區的 500 × 4000 mm 校出 28.98 mm/px，場地內緣在圖上剛好是 241.5 px 見方，兩軸吻合。
     滅火器 + 兩座抑制單元       後緣 x 1100–5900，前緣 y=1200 處 x 1826–5187；
                                 斜的是「外側」那條邊，正面是一條長邊（每座約 1130 mm 寬）
     滅火器 EXTINGUISHER         x 2950–4050，夾在兩座抑制單元中間
     支架 BRACE                  從火盾旁的護欄 (1200,6750) 拉到滅火器上緣外角 (2900,1200)
     火盾 FIRE SHIELD            下方兩個角，斜面朝場內，PORT 在斜面上
     出發區 REGIONAL ZONE        貼左右護欄，500 寬 × 4060 長，y 768–4825（偏向結構那一側）  */
const MP_BRACE = {
  r: {x1:1200, y1:6750, x2:2900, y2:1200},
  b: {x1:5800, y1:6750, x2:4100, y2:1200}
};
function mapBraceSeg(b,a,z){                 // 把支架切成三段 ZONE，低的那端是 ZONE 1
  const at=k=>({x:b.x1+(b.x2-b.x1)*k, y:b.y1+(b.y2-b.y1)*k});
  const p=at(a), q=at(z);
  return `<line x1="${p.x.toFixed(0)}" y1="${p.y.toFixed(0)}" x2="${q.x.toFixed(0)}" y2="${q.y.toFixed(0)}" class="br z${Math.round(a*3)+1}"/>`;
}
function mapFieldSVG(){
  const tx=(x,y,s,cls,rot)=>`<text x="${x}" y="${y}"${cls?` class="${cls}"`:''}${rot?` transform="rotate(${rot} ${x} ${y})"`:''}>${esc(s)}</text>`;
  let s='';
  s+=`<rect x="0" y="0" width="7000" height="7000" rx="60" class="mp-carpet"/>`;
  /* 聯盟站：在護欄外面，紅左藍右（照官方圖面的擺法） */
  s+=`<rect x="-700" y="300" width="480" height="6400" rx="40" class="mp-stn r"/>`;
  s+=`<rect x="7220" y="300" width="480" height="6400" rx="40" class="mp-stn b"/>`;
  s+=tx(-460,3500,t('mp.stnR'),'mp-t stn',-90)+tx(7460,3500,t('mp.stnB'),'mp-t stn',90);
  /* 出發區 */
  s+=`<rect x="0" y="768" width="507" height="4057" class="mp-zone r"/>`;
  s+=`<rect x="6493" y="768" width="507" height="4057" class="mp-zone b"/>`;
  s+=tx(253,2800,t('mp.start'),'mp-t sm',-90)+tx(6747,2800,t('mp.start'),'mp-t sm',90);
  /* 抑制單元 ×2 + 滅火器：三塊拼起來就是官方圖上那個梯形 */
  s+=`<polygon points="1100,0 2950,0 2950,1200 1826,1200" class="mp-sup r"/>`;
  s+=`<polygon points="5900,0 4050,0 4050,1200 5174,1200" class="mp-sup b"/>`;
  s+=`<rect x="2950" y="0" width="1100" height="1200" class="mp-ext"/>`;
  /* 三個標籤同高並排：抑制單元的機身夠寬放得下，滅火器那格窄，用更小一級的字 */
  s+=tx(2020,620,t('mp.sup'),'mp-t xs')+tx(4980,620,t('mp.sup'),'mp-t xs')+tx(3500,620,t('mp.ext'),'mp-t xxs');
  /* 支架：低端在火盾旁，ZONE 1 → 3 由低到高 */
  MP_SIDES.forEach(k=>{ const b=MP_BRACE[k];
    s+=mapBraceSeg(b,0,1/3)+mapBraceSeg(b,1/3,2/3)+mapBraceSeg(b,2/3,1);
    for(let i=0;i<3;i++){ const k2=(i+0.5)/3, x=b.x1+(b.x2-b.x1)*k2, y=b.y1+(b.y2-b.y1)*k2;
      s+=tx(x+(k==='r'?-300:300),y,'Z'+(i+1),'mp-t zn'); } });
  /* 火盾：佔住下方兩個角，斜面朝場內，PORT（機器人推球進去的洞）在斜面靠內側那一段 */
  s+=`<polygon points="0,5806 1250,6750 1250,7000 0,7000" class="mp-shield r"/>`;
  s+=`<polygon points="7000,5806 5750,6750 5750,7000 7000,7000" class="mp-shield b"/>`;
  s+=`<line x1="640" y1="6280" x2="1250" y2="6750" class="mp-port r"/>`;
  s+=`<line x1="6360" y1="6280" x2="5750" y2="6750" class="mp-port b"/>`;
  s+=tx(430,6800,t('mp.shield'),'mp-t sm')+tx(6570,6800,t('mp.shield'),'mp-t sm');
  s+=`<rect x="0" y="0" width="7000" height="7000" rx="60" class="mp-rail"/>`;
  return `<svg viewBox="${MP.VB.x} ${MP.VB.y} ${MP.VB.w} ${MP.VB.h}" class="mp-svg" aria-hidden="true">${s}</svg>`;
}

/* ---------- 圖標 ---------- */
const mpPctX = mm=>((mm-MP.VB.x)/MP.VB.w*100);
const mpPctY = mm=>((mm-MP.VB.y)/MP.VB.h*100);
/* 按鈕本身是透明的觸控區，看得見的只有裡面那顆 .dot。
   圖標照比例只會有場地的 6% 左右（機器人約 45 cm），手指按不到；分開之後
   圓可以畫小、接近實際大小，按的範圍仍然維持在好按的尺寸。 */
function mapTokenHTML(side,i,r){
  const nm=r.slug?nName(r.slug):(MP_LBL[side]+(i+1));
  return `<button class="mp-bot ${side}" data-s="${side}" data-i="${i}" style="left:${mpPctX(r.x).toFixed(3)}%;top:${mpPctY(r.y).toFixed(3)}%"
    aria-label="${esc(nm)}"><span class="dot"><span class="n">${MP_LBL[side]}${i+1}</span>${r.slug?`<span class="f">${nFlag(r.slug)}</span>`:''}</span></button>`;
}
function mapRender(){
  if(!DB||!$('mpField')) return;
  const st=mapState();
  $('mpField').innerHTML=mapFieldSVG()+MP_SIDES.map(s=>st[s].map((r,i)=>mapTokenHTML(s,i,r)).join('')).join('');
  /* segInit 在「再點一次已選的那顆」時會回傳空字串（取消選取）。那在這裡會變成 0 台，
     等於手滑一下就把排好的站位全清掉。空字串一律當沒事發生，要清就去點 0。 */
  MP_SIDES.forEach(s=>{ const seg=$('mp'+s.toUpperCase()+'N'); if(!seg) return;
    segInit(seg,String(st[s].length),v=>{ if(v==='') mapRender(); else mapSetCount(s,parseInt(v,10)); }); });
  const n=st.r.length+st.b.length;
  $('mpNames').innerHTML=n?MP_SIDES.map(s=>st[s].map((r,i)=>
      `<span class="mp-chip ${s}">${MP_LBL[s]}${i+1}<b>${r.slug?esc(nName(r.slug)):'—'}</b></span>`).join('')).join(''):'';
  $('mpEmpty').hidden=n>0;
  $('mpField').querySelectorAll('.mp-bot').forEach(mapBindDrag);
  mapExpBtn();
}
function mapSetCount(side,n){
  const st=mapState(), cur=st[side].length;
  n=Math.max(0,Math.min(MP.MAX,n|0));
  if(n===cur) return;
  while(st[side].length<n){ const i=st[side].length; st[side].push(Object.assign({slug:''},mapStart(side,i))); }
  st[side].length=n;
  touchCfg(); haptic(12); mapRender();
}

/* 拖曳用 pointer 事件：滑鼠、手指、觸控筆同一套。指標按住後鎖在這顆圖標上（setPointerCapture），
   手指滑出圖標範圍也不會掉拖曳。沒有移動就當成點一下，開設定表。 */
function mapBindDrag(el){
  const side=el.dataset.s, idx=+el.dataset.i;
  let box=null, dx=0, dy=0, moved=false, id=null;
  const mm=e=>{ const fx=(e.clientX-box.left)/box.width, fy=(e.clientY-box.top)/box.height;
    return {x:MP.VB.x+fx*MP.VB.w, y:MP.VB.y+fy*MP.VB.h}; };
  el.addEventListener('pointerdown',e=>{
    const r=mapState()[side][idx]; if(!r) return;
    box=$('mpField').getBoundingClientRect(); id=e.pointerId; moved=false;
    const p=mm(e); dx=r.x-p.x; dy=r.y-p.y;
    el.setPointerCapture(id); el.classList.add('drag'); e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(id===null||e.pointerId!==id||!box) return;
    const r=mapState()[side][idx]; if(!r) return;
    const p=mm(e);
    const nx=mapClamp(p.x+dx), ny=mapClamp(p.y+dy);
    if(Math.abs(nx-r.x)>60||Math.abs(ny-r.y)>60) moved=true;
    r.x=nx; r.y=ny;
    el.style.left=mpPctX(nx).toFixed(3)+'%'; el.style.top=mpPctY(ny).toFixed(3)+'%';
    save();                                  // 拖的時候只存本機（已經有防抖），放開才推同步
  });
  const end=e=>{
    if(id===null||(e.pointerId!=null&&e.pointerId!==id)) return;
    el.classList.remove('drag'); id=null;
    if(moved){ touchCfg(); haptic(8); } else mapSheet(side,idx);
  };
  el.addEventListener('pointerup',end);
  el.addEventListener('pointercancel',end);
}

function mapSheet(side,idx){
  const st=mapState(), r=st[side][idx]; if(!r) return;
  const nm=MP_LBL[side]+(idx+1);
  const {sh,close}=openSheet(`<div class="hd"><b style="font-size:17px">${side==='r'?'🔴':'🔵'} ${esc(nm)}${r.slug?' · '+esc(nName(r.slug)):''}</b>
      <button class="btn" data-close style="margin-left:auto;min-height:44px;padding:8px 14px">${esc(t('menu.close'))}</button></div>
    <div class="menu">
      <button class="btn wide" id="mpPick">${esc(r.slug?t('mp.changeCountry'):t('mp.setCountry'))}</button>
      ${r.slug?`<button class="btn wide" id="mpClr" style="margin-top:8px">${esc(t('mp.clearCountry'))}</button>`:''}
      <button class="btn wide" id="mpHome" style="margin-top:8px">${esc(t('mp.toStart'))}</button>
      <button class="btn dgr wide" id="mpDel" style="margin-top:8px">${esc(t('mp.remove'))}</button>
      <p class="note" style="margin-top:10px">${esc(t('mp.sheetNote'))}</p></div>`);
  sh.querySelector('#mpPick').onclick=()=>{ close(); openPicker(sl=>{ r.slug=sl; touchCfg(); mapRender(); }); };
  const clr=sh.querySelector('#mpClr'); if(clr) clr.onclick=()=>{ r.slug=''; touchCfg(); mapRender(); close(); };
  sh.querySelector('#mpHome').onclick=()=>{ Object.assign(r,mapStart(side,idx)); touchCfg(); mapRender(); close(); };
  sh.querySelector('#mpDel').onclick=()=>{ st[side].splice(idx,1); touchCfg(); haptic(12); mapRender(); close(); };
}

function mapReset(){
  const st=mapState();
  MP_SIDES.forEach(s=>st[s].forEach((r,i)=>Object.assign(r,mapStart(s,i))));
  touchCfg(); mapRender(); toast(t('mp.resetDone'),'ok');
}
function mapClear(){
  const st=mapState(); MP_SIDES.forEach(s=>{ st[s].length=0; });
  touchCfg(); mapRender();
}
/* 全螢幕：場地接近正方形，實際大小由螢幕短邊決定。平常那條短邊要分給導覽列、卡片邊距和
   上面那張控制卡，全螢幕才拿得回來 —— 也是轉成橫向唯一真的會變大的情況。 */
function mapExpBtn(){                              // 換語言時 applyLang 只會重畫 [data-i18n]，
  const b=$('mpExp'); if(!b) return;               // 這顆鈕的字在 aria-label 上，得自己跟著更新
  const on=document.body.classList.contains('mp-full');
  b.textContent = on?'✕':'⛶';
  b.setAttribute('aria-label', t(on?'mp.exit':'mp.expand'));
}
function mapFull(on){ document.body.classList.toggle('mp-full',!!on); mapExpBtn(); }
function mapToggleFull(){ mapFull(!document.body.classList.contains('mp-full')); }

/* map.js 比 app.js 早載入，所以按鈕不能在最外層綁（那時候 $ / t 都還不存在）。
   一律等 app.js 切到這一頁、呼叫 mapLoad() 之後再綁；重複指定 onclick 沒有副作用。 */
let MP_KEYS=false;
function mapLoad(){
  if(!DB||!$('mpField')) return;
  $('mpReset').onclick=mapReset;
  $('mpClear').onclick=mapClear;
  $('mpExp').onclick=mapToggleFull;
  if(!MP_KEYS){ MP_KEYS=true;                    // Esc 退出全螢幕，鍵盤使用者才有退路
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.body.classList.contains('mp-full')) mapFull(false); }); }
  mapFull(document.body.classList.contains('mp-full'));
  mapRender();
}
