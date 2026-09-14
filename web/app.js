'use strict';
/* FGC 2026 Scouting — app logic
   Sections: i18n · data · auth · widgets · country picker · match · pit · nations · robot · calc · data tab · ux · sync · init */
const NATIONS = window.NATIONS || [];
const NMAP = Object.fromEntries(NATIONS.map(n=>[n.slug,n]));
const $ = id=>document.getElementById(id);
const esc = s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const now = ()=>new Date().toISOString();
const RM_SYS = matchMedia('(prefers-reduced-motion:reduce)').matches;
let RM = RM_SYS;   // 實際採用的值：cfg.fx 可以覆寫系統設定
const HTTP = /^https?:$/.test(location.protocol);
const CLIMB_MULT = {'':0,'0':0,'C':0.05,'1':0.10,'2':0.20,'3':0.30};
const CLIMB_TAG = {'':'','0':'','C':'C','1':'z1','2':'z2','3':'z3'};

/* ---------- i18n ---------- */
const DICT = window.I18N || {en:{}}; const META = window.I18N_META || [['en','English']]; const RTL = window.I18N_RTL || [];
let LANG='en'; try{ const l=localStorage.getItem('fgc.lang'); if(l&&DICT[l]) LANG=l; }catch(e){}
function t(k){ const d=DICT[LANG]||{}; if(k in d) return d[k]; return (k in DICT.en)?DICT.en[k]:k; }
function tEn(k){ return (k in DICT.en)?DICT.en[k]:''; }
function hintFor(k){ const hk=k+'H'; const has=(DICT[LANG]&&hk in DICT[LANG])||(hk in DICT.en); const parts=[];
  if(has&&t(hk)) parts.push(t(hk)); if(LANG!=='en'&&tEn(k)) parts.push(tEn(k)); return parts.join(' · '); }
/* label maps rebuilt on every language change (mutated in place so all call sites stay simple) */
const CLIMB_LABEL={}, TYPE_LABEL={}, POS_LABEL={}, ROLE={}, TRI={'2':'✓','1':'△','0':'✗'}, TRIL={}, STATE_LBL={}, PHASE_LABEL={}, DIMS=[];
function relabel(){
  Object.assign(PHASE_LABEL,{prac:t('m.practice'),qual:t('m.quals'),play:t('m.playoffs')});
  Object.assign(CLIMB_LABEL,{'':'—','0':t('m.none'),'C':t('m.contact'),'1':t('m.zone')+' 1','2':t('m.zone')+' 2','3':t('m.zone')+' 3'});
  Object.assign(TYPE_LABEL,{s1:t('p.single'),s2:t('p.dual'),s3:t('p.triple'),wf:t('p.waterfall')});
  Object.assign(POS_LABEL,{wall:t('p.wall'),front:t('p.front'),center:t('p.center'),port:t('p.portZone'),brace:t('p.brace'),roam:t('p.roam')});
  Object.assign(ROLE,{shoot:t('p.shooter'),feed:t('p.feeder'),climb:t('p.climber'),carry:t('p.carrier')});
  Object.assign(TRIL,{'2':t('p.reliable'),'1':t('p.sometimes'),'0':t('p.cant'),'':''});
  Object.assign(STATE_LBL,{stuck:t('m.stuck'),dead:t('m.dead'),late:t('m.late')});
  DIMS.length=0; DIMS.push(['shoot',t('n.dShoot')],['fire',t('n.dFire')],['speed',t('n.dSpeed')],['climb',t('n.dClimb')],['carry',t('n.dSupport')],['port',t('n.dFeed')]); }
function applyLang(){ relabel(); document.documentElement.lang=LANG; document.documentElement.dir=RTL.includes(LANG)?'rtl':'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent=t(el.dataset.i18n); });
  /* 頁尾的愛心要能跳動，所以從翻譯字串裡把它抽出來包成元素 */
  document.querySelectorAll('footer.made [data-i18n]').forEach(el=>{
    el.innerHTML=esc(t(el.dataset.i18n)).replace('♥','<span class="hb">♥</span>'); });
  document.querySelectorAll('[data-hint]').forEach(el=>{ const s=hintFor(el.dataset.hint); el.textContent=s; el.hidden=!s; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder=t(el.dataset.i18nPh); });
  document.querySelectorAll('select.langsel').forEach(sel=>{ if(!sel.options.length) META.forEach(([c,n])=>{ const o=document.createElement('option'); o.value=c; o.textContent=n; sel.appendChild(o); }); sel.value=LANG; });
  SLOTS.forEach(L=>{ const b=$(L+'Country'); if(b&&!b.dataset.v) setCbtn(b,'',t('m.whichCountry')); });
  if(!$('pCountry').dataset.v) setCbtn($('pCountry'),'');
  if(DB&&$('mWho')) $('mWho').innerHTML=`<span class="fl">${nFlag(AUTH.team)}</span><span><span class="lb">${esc(t('m.weAre'))}</span><b>${esc(nName(AUTH.team))}</b></span>`;
    if(DB){ renderMList(); if(!$('tab-teams').hidden&&rMode==='teams') renderTeams(); if(!$('tab-pit').hidden&&curTeam) loadPit(); if(!$('tab-robot').hidden) robotLoad(); calc(); if(!$('tab-data').hidden) refreshData(); }
  if(SYNC.last.k) setSync(SYNC.last.k,SYNC.last.c,SYNC.last.extra); }
function setLang(l){ if(!DICT[l]) return; LANG=l; try{ localStorage.setItem('fgc.lang',l); }catch(e){} applyLang(); }
document.addEventListener('change',e=>{ if(e.target.matches('select.langsel')) setLang(e.target.value); });

/* ---------- data (per signed-in team) ---------- */
const AUTH = {token:'',team:'',offline:false};
const SYNC={on:false,busy:false,dirty:true,rev:-1,lastPoll:0,POLL:30000,last:{k:'',c:'',extra:''}};
const skipKey = tm=>'fgc.skipPw.'+tm;
let DB = null, K = '';
function nName(s){ if(NMAP[s]) return NMAP[s].name; if(DB&&DB.cfg.custom&&DB.cfg.custom[s]) return DB.cfg.custom[s]; return s||''; }
function nZh(s){ return NMAP[s]?(NMAP[s].zh||''):''; }
function nSub(s){ return LANG.startsWith('zh')?nZh(s):''; }
/* flag as <img> (flags/<cc>.svg) when served over http — emoji flags don't render on Windows; emoji fallback offline */
function nFlag(s){ const n=NMAP[s]; if(!n) return s?'🏳️':'🌍'; return (HTTP&&n.cc)?`<img class="flag" src="flags/${n.cc}.svg" alt="${n.flag}" loading="lazy">`:n.flag; }
function nFlagTxt(s){ return NMAP[s]?NMAP[s].flag:(s?'🏳️':'🌍'); }
function norm(d){ d.cfg=d.cfg||{}; d.cfg.scout=d.cfg.scout||''; d.cfg.theme=d.cfg.theme||'auto'; d.cfg.event=d.cfg.event||'FGC 2026 Igniting Innovation';
  d.cfg.recent=Array.isArray(d.cfg.recent)?d.cfg.recent:[]; d.cfg.fx=d.cfg.fx||'auto'; d.cfg.custom=(d.cfg.custom&&typeof d.cfg.custom==='object')?d.cfg.custom:{};
  d.cfg.plan=(d.cfg.plan&&typeof d.cfg.plan==='object')?d.cfg.plan:{match:0,a:'',b:'',phase:'qual'};
  d.cfg.plan.phase=d.cfg.plan.phase||'qual';
  d.pit=d.pit||{}; d.match=Array.isArray(d.match)?d.match:[]; d.robot=(d.robot&&typeof d.robot==='object')?d.robot:null; return d; }
function load(){ try{ const r=JSON.parse(localStorage.getItem(K)); if(r&&r.cfg) return norm(r); }catch(e){} return norm({}); }
let tSave=null;
function save(){ if(!SYNC.applying) SYNC.dirty=true; clearTimeout(tSave); tSave=setTimeout(saveNow,250); }
function saveNow(){ clearTimeout(tSave); if(!DB) return; if(!SYNC.applying) SYNC.dirty=true; try{ localStorage.setItem(K,JSON.stringify(DB)); }catch(e){} }
const live = ()=>DB?DB.match.filter(m=>!m.del):[];
function touchCfg(){ DB.cfg.ts=now(); save(); }

/* ---------- auth ---------- */
async function api(path,body){
  const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Token':AUTH.token},body:body?JSON.stringify(body):undefined});
  let d={}; try{ d=await r.json(); }catch(e){}
  if(r.status===401){ signedOut(); throw new Error(t('s.again')); }
  if(!r.ok){ const e=new Error(d.error||('HTTP '+r.status)); e.status=r.status; e.needClaim=!!d.needClaim; throw e; }
  return d;
}
function showAuth(view){ $('auth').hidden=false; $('main').hidden=true; $('nav').hidden=true; $('mFab').hidden=true; document.querySelector('header').hidden=true;
  ['authLogin','authSet','authClaim','authOffline'].forEach(id=>$(id).hidden=(id!==view));
  if(view==='authSet') $('aWho').innerHTML=`<span class="fl">${nFlag(AUTH.team)}</span><b>${esc(nName(AUTH.team))}</b> <span class="zh">${esc(nSub(AUTH.team))}</span>`; }
function showErr(el,msg){ el.textContent=msg; el.hidden=!msg; }
function signedOut(){ AUTH.token=''; SYNC.on=false; try{ localStorage.removeItem('fgc.auth'); }catch(e){} setSync('s.signedOut'); showAuth('authLogin'); }
function skipped(team){ try{ return localStorage.getItem(skipKey(team))==='1'; }catch(e){ return false; } }
function boot(team){
  AUTH.team=team; K='fgc2026.scouting.'+team; DB=load();
  try{ localStorage.setItem('fgc.team',team); }catch(e){}
  $('teamBtn').innerHTML=`<span class="fl">${nFlag(team)}</span><span class="nm">${esc(nName(team))}</span>`;
  $('auth').hidden=true; $('main').hidden=false; $('nav').hidden=false; document.querySelector('header').hidden=false;
  document.querySelector('nav button[data-tab=match]').click();
  applyTheme(); applyFX(); mountSlots(); applyLang(); initRanks(); mLoad(); scLoad(); renderPublished(); renderMList(); refreshData(); calc();
  if(!AUTH.offline){ SYNC.on=true; SYNC.rev=-1; SYNC.dirty=true; SYNC.lastPoll=0; push(true); loadProfiles(); } else setSync('s.local');
}
$('aTeam').onclick=()=>openPicker(sl=>setCbtn($('aTeam'),sl,t('auth.selectCountry')),{custom:false});
$('aTeamOff').onclick=()=>openPicker(sl=>setCbtn($('aTeamOff'),sl,t('auth.selectCountry')),{custom:false});
$('aEye').onclick=()=>{ const i=$('aPw'); i.type=i.type==='password'?'text':'password'; };
$('aPw').addEventListener('keydown',e=>{ if(e.key==='Enter') $('aGo').click(); });
function afterLogin(d){
  AUTH.token=d.token; AUTH.team=d.team;
  try{ localStorage.setItem('fgc.auth',JSON.stringify({token:d.token,team:d.team})); }catch(e){}
  LAST_LOGIN=d.prevLogin||null;
  $('aPw').value=''; haptic(18);
  if(d.mustChange&&!skipped(d.team)) showAuth('authSet'); else boot(d.team);
}
let LAST_LOGIN=null, CLAIMING='';
$('aGo').onclick=async()=>{
  const tm=$('aTeam').dataset.v, pw=$('aPw').value;
  if(!tm){ flash($('aTeam')); showErr($('aErr'),t('auth.errCountry')); return; }
  showErr($('aErr'),''); $('aGo').disabled=true;
  try{ afterLogin(await api('/api/login',{team:tm,password:pw})); }
  catch(e){
    /* 這個國家還沒有人認領 → 需要主辦方發的認領碼，不能用共用密碼進來 */
    if(e.needClaim){ CLAIMING=tm; showClaim(tm); }
    else { showErr($('aErr'),e.message); flash($('aPw')); }
  }
  finally{ $('aGo').disabled=false; }
};
function showClaim(tm){
  $('aWhoC').innerHTML=`<span class="fl">${nFlag(tm)}</span><b>${esc(nName(tm))}</b> <span class="zh">${esc(nSub(tm))}</span>`;
  $('aCode').value=''; $('aCNew').value=''; $('aCNew2').value=''; showErr($('aErrC'),'');
  showAuth('authClaim');
}
$('aCBack').onclick=()=>{ CLAIMING=''; showAuth('authLogin'); };
$('aClaimGo').onclick=async()=>{
  const code=$('aCode').value.trim(), n=$('aCNew').value, n2=$('aCNew2').value;
  showErr($('aErrC'),'');
  if(!code){ flash($('aCode')); showErr($('aErrC'),t('auth.needCode')); return; }
  if(n.length<4){ flash($('aCNew')); showErr($('aErrC'),t('auth.pwShort')); return; }
  if(n!==n2){ flash($('aCNew2')); showErr($('aErrC'),t('auth.pwNoMatch')); return; }
  $('aClaimGo').disabled=true;
  try{ afterLogin(await api('/api/claim',{team:CLAIMING,code,password:n})); }
  catch(e){ showErr($('aErrC'),e.message); flash($('aCode')); }
  finally{ $('aClaimGo').disabled=false; }
};
$('aSet').onclick=async()=>{
  const n=$('aNew').value, n2=$('aNew2').value;
  if(n.length<4){ showErr($('aErr2'),t('auth.errShort')); flash($('aNew')); return; }
  if(n!==n2){ showErr($('aErr2'),t('auth.errMatch')); flash($('aNew2')); return; }
  showErr($('aErr2'),''); $('aSet').disabled=true;
  try{ await api('/api/password',{current:'password',new:n}); $('aNew').value=$('aNew2').value=''; try{ localStorage.removeItem(skipKey(AUTH.team)); }catch(e){} toast(t('auth.pwSet'),'ok'); boot(AUTH.team); }
  catch(e){ showErr($('aErr2'),e.message); }
  finally{ $('aSet').disabled=false; }
};
$('aBack').onclick=()=>{ api('/api/logout').catch(()=>{}); signedOut(); };
$('aSkip').onclick=()=>{ try{ localStorage.setItem(skipKey(AUTH.team),'1'); }catch(e){} toast(t('auth.keepDefault')); boot(AUTH.team); };
$('aGoOff').onclick=()=>{ const tm=$('aTeamOff').dataset.v; if(!tm){ flash($('aTeamOff')); return; } boot(tm); };
$('langBtn').onclick=()=>{
  const {sh,close}=openSheet(`<div class="hd"><b style="font-size:17px">🌐 ${esc(t('d.language'))}</b><button class="btn" data-close style="margin-left:auto;min-height:44px;padding:8px 14px">${esc(t('menu.close'))}</button></div>
    <div class="langgrid">${META.map(([c,n])=>`<button data-l="${c}" aria-pressed="${c===LANG}">${esc(n)}</button>`).join('')}</div>`);
  sh.querySelectorAll('.langgrid button').forEach(b=>b.onclick=()=>{ setLang(b.dataset.l); close(); haptic(12); }); };
$('teamBtn').onclick=()=>{
  const {sh,close}=openSheet(`<div class="hd"><b style="font-size:17px">${nFlag(AUTH.team)} ${esc(nName(AUTH.team))}</b><button class="btn" data-close style="margin-left:auto;min-height:44px;padding:8px 14px">${esc(t('menu.close'))}</button></div>
    <div class="menu">${AUTH.offline?`<p class="note">${esc(t('menu.localNote'))}</p>`:`
      <div class="f"><label>${esc(t('menu.changePw'))}</label>
        <input type="password" id="cpCur" placeholder="${esc(t('menu.curPw'))}" autocomplete="current-password" style="margin-bottom:8px">
        <input type="password" id="cpNew" placeholder="${esc(t('menu.newPw'))}" autocomplete="new-password"></div>
      <button class="btn wide" id="cpGo">${esc(t('menu.update'))}</button><p class="err" id="cpErr" hidden></p>`}
      <div class="f" style="margin-top:14px"><label>${esc(t('d.language'))}</label><select class="langsel"></select></div>
      <button class="btn dgr wide" id="soGo" style="margin-top:12px">${esc(AUTH.offline?t('menu.switchTeam'):t('menu.signout'))}</button>
      <p class="note" style="margin-top:8px">${esc(t('menu.note'))}</p></div>`);
  const sel=sh.querySelector('select.langsel'); META.forEach(([c,n])=>{ const o=document.createElement('option'); o.value=c; o.textContent=n; sel.appendChild(o); }); sel.value=LANG;
  const cp=sh.querySelector('#cpGo'); if(cp) cp.onclick=async()=>{ const c=sh.querySelector('#cpCur').value,n=sh.querySelector('#cpNew').value; const er=sh.querySelector('#cpErr');
    if(n.length<4){ showErr(er,t('auth.errShort')); return; } cp.disabled=true;
    try{ await api('/api/password',{current:c,new:n}); try{ localStorage.removeItem(skipKey(AUTH.team)); }catch(e){} toast(t('auth.pwSet'),'ok'); close(); }catch(e){ showErr(er,e.message); } finally{ cp.disabled=false; } };
  sh.querySelector('#soGo').onclick=()=>{ close(); saveNow(); if(AUTH.offline){ DB=null; showAuth('authOffline'); } else { api('/api/logout').catch(()=>{}); signedOut(); } };
};

/* ---------- tabs ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.setAttribute('aria-selected',x===b));
  ['match','pit','teams','robot','calc','data'].forEach(tb=>$('tab-'+tb).hidden=(tb!==b.dataset.tab));
  const m=b.dataset.tab==='match'; $('mFab').hidden=!m; $('main').classList.toggle('fab-on',m);
  if(b.dataset.tab==='data') refreshData();
  if(b.dataset.tab==='teams') ranksLoad();
  if(b.dataset.tab==='calc') calc();
  if(b.dataset.tab==='robot') robotLoad();
  window.scrollTo(0,0);
});

/* ---------- widgets ---------- */
function segInit(el,val,cb){ el.querySelectorAll('button').forEach(b=>{
  b.setAttribute('aria-pressed',String(b.dataset.v===String(val)));
  b.onclick=()=>{ const on=b.getAttribute('aria-pressed')==='true';
    el.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
    if(!on){ b.setAttribute('aria-pressed','true'); cb(b.dataset.v); } else cb(''); }; }); }
function segVal(id){ const b=$(id).querySelector('button[aria-pressed=true]'); return b?b.dataset.v:''; }
function chipsInit(el,vals,cb){ const set=new Set(vals||[]); el.querySelectorAll('button').forEach(b=>{
  b.setAttribute('aria-pressed',String(set.has(b.dataset.v)));
  b.onclick=()=>{ const on=b.getAttribute('aria-pressed')!=='true'; b.setAttribute('aria-pressed',String(on));
    cb([...el.querySelectorAll('button[aria-pressed=true]')].map(x=>x.dataset.v)); }; }); }
function tgInit(el,val,cb){ el.setAttribute('aria-pressed',String(!!val)); el.onclick=()=>{ const v=el.getAttribute('aria-pressed')!=='true'; el.setAttribute('aria-pressed',String(v)); cb(v); }; }
document.addEventListener('click',e=>{ const b=e.target.closest('.step button'); if(!b) return;
  const inp=b.parentElement.querySelector('input'); inp.value=Math.max(0,(parseInt(inp.value,10)||0)+parseInt(b.dataset.d,10));
  inp.dispatchEvent(new Event('input',{bubbles:true})); });
function applyTheme(){ const th=DB?DB.cfg.theme:'auto'; if(th==='auto') document.documentElement.removeAttribute('data-t'); else document.documentElement.setAttribute('data-t',th); }
function openSheet(inner){
  const dim=document.createElement('div'); dim.id='dim';
  const sh=document.createElement('div'); sh.id='sheet'; sh.innerHTML=inner;
  document.body.append(dim,sh);
  const close=()=>{ dim.remove(); sh.remove(); };
  dim.onclick=close; sh.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
  return {sh,close};
}

/* ---------- country picker ---------- */
function setCbtn(btn,slug,ph){ btn.dataset.v=slug||''; btn.classList.toggle('set',!!slug);
  btn.innerHTML=slug?`<span class="fl">${nFlag(slug)}</span><span>${esc(nName(slug))}<span class="sub">${esc(nSub(slug))}</span></span><span class="arr">›</span>`
                    :`<span class="fl">🌍</span><span class="ph">${esc(ph||t('k.select'))}</span><span class="arr">›</span>`; }
function openPicker(cb,opt){ opt=opt||{};
  const {sh,close}=openSheet(`<div class="hd"><input type="text" id="pkQ" placeholder="${esc(t('k.search'))}" autocomplete="off"><button class="btn" data-close style="min-height:46px;padding:8px 14px">${esc(t('menu.close'))}</button></div><div class="grid" id="pkG"></div>`);
  const g=sh.querySelector('#pkG'), q=sh.querySelector('#pkQ');
  const card=(slug,name,flag,sub,cls)=>`<button class="c ${cls||''}" data-v="${esc(slug)}"><span class="fl">${flag}</span><span>${esc(name)}<span class="zh">${esc(sub||'')}</span></span></button>`;
  const render=()=>{ const s=q.value.trim().toLowerCase();
    const hit=NATIONS.filter(n=>!s||n.name.toLowerCase().includes(s)||n.slug.includes(s)||(n.zh||'').includes(s));
    let h='';
    if(!s&&DB){ const rec=[...DB.cfg.recent].filter((v,i,a)=>v&&a.indexOf(v)===i&&(NMAP[v]||DB.cfg.custom[v])).slice(0,8);
      if(rec.length){ h+=`<div class="lab">${esc(t('k.recent'))}</div>`+rec.map(sl=>card(sl,nName(sl),nFlag(sl),nSub(sl),'rec')).join('')+`<div class="lab">${esc(t('k.all'))}</div>`; } }
    h+=hit.map(n=>card(n.slug,n.name,nFlag(n.slug),nSub(n.slug))).join('');
    if(DB&&opt.custom!==false){ const cs=Object.entries(DB.cfg.custom).filter(([k,v])=>!s||v.toLowerCase().includes(s));
      if(cs.length) h+=`<div class="lab">${esc(t('k.added'))}</div>`+cs.map(([k,v])=>card(k,v,'🏳️','')).join('');
      if(s.length>=2&&!hit.some(n=>n.name.toLowerCase()===s)) h+=`<button class="c add" data-add="${esc(q.value.trim())}"><span class="fl">➕</span><span>${esc(t('k.use'))} “${esc(q.value.trim())}”<span class="zh">${esc(t('k.notListed'))}</span></span></button>`; }
    if(!h) h=`<div class="empty">${esc(t('k.noMatch'))}</div>`;
    g.innerHTML=h;
    g.querySelectorAll('.c').forEach(b=>b.onclick=()=>{ let sl=b.dataset.v;
      if(b.dataset.add){ const nm=b.dataset.add; sl='x-'+nm.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); DB.cfg.custom[sl]=nm; touchCfg(); }
      if(DB){ DB.cfg.recent=[sl,...DB.cfg.recent.filter(x=>x!==sl)].slice(0,8); save(); }
      close(); cb(sl); }); };
  q.oninput=render; render();
  setTimeout(()=>{ try{ q.focus({preventScroll:true}); }catch(e){} },150);
}

/* ---------- MATCH (one card per partner country; our own robot is not scouted here) ---------- */
const SLOTS=['A','B']; const EDIT={A:null,B:null};
function slotHTML(L){ return `
<div class="card slot" id="${L}Card">
  <h2><span class="ic">${L==='A'?'①':'②'}</span><span data-i18n="m.slot${L}">Teammate ${L}</span><span class="zh" data-hint="m.slot${L}"></span></h2>
  <button class="cbtn" id="${L}Country" data-v=""><span class="fl">🌍</span><span class="ph"></span><span class="arr">›</span></button>
  <div class="sbody" id="${L}Body" hidden>
    <div class="f" style="margin-top:16px"><label><span data-i18n="m.sup">Into SUPPRESSION UNIT</span> <span class="zh" data-hint="m.sup"></span></label>
      <div class="step" data-k="${L}Sup"><button class="big" data-d="-5">−5</button><button data-d="-1">−</button><input type="number" id="${L}Sup" inputmode="numeric" value="0"><button data-d="1">+</button><button class="big" data-d="5">+5</button></div></div>
    <div class="f"><label><span data-i18n="m.port">Into FIRE SHIELD PORT</span> <span class="zh" data-hint="m.port"></span></label>
      <div class="step" data-k="${L}Port"><button class="big" data-d="-5">−5</button><button data-d="-1">−</button><input type="number" id="${L}Port" inputmode="numeric" value="0"><button data-d="1">+</button><button class="big" data-d="5">+5</button></div></div>
    <div class="f"><label><span data-i18n="m.endPos">End-of-match position</span> <span class="zh" data-hint="m.endPos"></span></label>
      <div class="seg n5" id="${L}Climb">
        <button data-v="0" data-c="gray"><span data-i18n="m.none">None</span><small>×0</small></button><button data-v="C" data-c="mid"><span data-i18n="m.contact">Contact</span><small>+.05</small></button>
        <button data-v="1" data-c="z1"><span data-i18n="m.zone">Zone</span> 1<small>+.10</small></button><button data-v="2" data-c="z2"><span data-i18n="m.zone">Zone</span> 2<small>+.20</small></button><button data-v="3" data-c="z3"><span data-i18n="m.zone">Zone</span> 3<small>+.30</small></button>
      </div></div>
    <div class="row">
      <div class="f"><label><span data-i18n="m.carried">Partners carried</span> <span class="zh" data-hint="m.carried"></span></label>
        <div class="seg n3" id="${L}Carry"><button data-v="0" data-c="gray">0</button><button data-v="1">1</button><button data-v="2">2</button></div></div>
      <div class="f"><label><span data-i18n="m.wasCarried">Was carried</span> <span class="zh" data-hint="m.wasCarried"></span></label>
        <div class="seg n2" id="${L}Carried"><button data-v="0" data-c="gray" data-i18n="m.no">No</button><button data-v="1" data-c="ok" data-i18n="m.yes">Yes</button></div></div>
    </div>
    <div class="f"><label><span data-i18n="m.climbAt">Started climbing at</span> <span class="zh" data-hint="m.climbAt"></span></label>
      <div class="seg n5" id="${L}ClimbAt"><button data-v="60">≥60s</button><button data-v="45">45s</button><button data-v="30">30s</button><button data-v="20">20s</button><button data-v="10">≤10s</button></div></div>
    <div class="f"><label><span data-i18n="m.status">Robot status</span> <span class="zh" data-hint="m.status"></span></label>
      <div class="seg" id="${L}State"><button data-v="ok" data-c="ok"><span data-i18n="m.ok">OK</span></button><button data-v="stuck" data-c="mid"><span data-i18n="m.stuck">Stuck / tipped</span></button><button data-v="dead" data-c="bad"><span data-i18n="m.dead">Dead</span></button><button data-v="late" data-c="mid"><span data-i18n="m.late">Late start</span></button></div></div>
    <div class="row">
      <div class="f"><label><span data-i18n="m.card">Card</span> <span class="zh" data-hint="m.card"></span></label>
        <div class="seg n4" id="${L}Card2"><button data-v="" data-c="gray" data-i18n="m.none">None</button><button data-v="W" data-c="W">⚪</button><button data-v="Y" data-c="Y">🟡</button><button data-v="R" data-c="R">🔴</button></div></div>
      <div class="f"><label><span data-i18n="m.driver">Driver rating</span> <span class="zh" data-hint="m.driver"></span></label>
        <div class="seg n5" id="${L}Rate"><button data-v="1" data-c="bad">1</button><button data-v="2" data-c="mid">2</button><button data-v="3">3</button><button data-v="4" data-c="ok">4</button><button data-v="5" data-c="ok">5</button></div></div>
    </div>
    <div class="f"><label><span data-i18n="m.notes">Notes</span> <span class="zh" data-hint="m.notes"></span></label><input type="text" id="${L}Notes" data-i18n-ph="m.notesPh" placeholder=""></div>
  </div>
</div>`; }
function mountSlots(){ SLOTS.forEach(L=>{ $('slot'+L).innerHTML=slotHTML(L);
  $(L+'Country').onclick=()=>openPicker(sl=>{ setCbtn($(L+'Country'),sl,t('m.whichCountry')); $(L+'Body').hidden=false; haptic(12); }); }); }
function slotReset(L){ EDIT[L]=null; setCbtn($(L+'Country'),'',t('m.whichCountry')); $(L+'Body').hidden=true;
  $(L+'Sup').value=0; $(L+'Port').value=0; $(L+'Notes').value='';
  segInit($(L+'Climb'),'0',()=>{}); segInit($(L+'Carry'),'0',()=>{}); segInit($(L+'Carried'),'0',()=>{});
  segInit($(L+'ClimbAt'),'',()=>{}); segInit($(L+'State'),'ok',()=>{}); segInit($(L+'Card2'),'',()=>{}); segInit($(L+'Rate'),'',()=>{}); }
function slotLoad(L,r){ if(!r){ slotReset(L); return; } EDIT[L]=r;
  setCbtn($(L+'Country'),r.team,t('m.whichCountry')); $(L+'Body').hidden=false;
  $(L+'Sup').value=r.sup||0; $(L+'Port').value=r.port||0; $(L+'Notes').value=r.notes||'';
  segInit($(L+'Climb'),r.climb||'0',()=>{}); segInit($(L+'Carry'),String(r.carry||0),()=>{}); segInit($(L+'Carried'),r.carried?'1':'0',()=>{});
  segInit($(L+'ClimbAt'),r.climbAt||'',()=>{}); segInit($(L+'State'),r.state||'ok',()=>{}); segInit($(L+'Card2'),r.card||'',()=>{}); segInit($(L+'Rate'),r.rate||'',()=>{}); }
function slotObj(L,other){ return {id:(EDIT[L]&&EDIT[L].id)||('m'+Date.now()+L+Math.random().toString(36).slice(2,5)),
  match:parseInt($('mMatch').value,10)||0, team:$(L+'Country').dataset.v, al:segVal('mAl'),
  p1:other||'', p2:AUTH.team,
  sup:parseInt($(L+'Sup').value,10)||0, port:parseInt($(L+'Port').value,10)||0,
  climb:segVal(L+'Climb'), carry:parseInt(segVal(L+'Carry')||'0',10), carried:segVal(L+'Carried')==='1', climbAt:segVal(L+'ClimbAt'),
  state:segVal(L+'State')||'ok', card:segVal(L+'Card2'), rate:segVal(L+'Rate'), notes:$(L+'Notes').value,
  phase:segVal('mPhase')||'qual', scout:DB.cfg.scout, ts:now()}; }
function alGlow(){ const a=segVal('mAl'); $('mHead').classList.toggle('alR',a==='R'); $('mHead').classList.toggle('alB',a==='B'); }
function mLoad(){ $('mWho').innerHTML=`<span class="fl">${nFlag(AUTH.team)}</span><span><span class="lb">${esc(t('m.weAre'))}</span><b>${esc(nName(AUTH.team))}</b></span>`;
  segInit($('mAl'),segVal('mAl'),alGlow); segInit($('mPhase'),segVal('mPhase')||'qual',()=>{});
  SLOTS.forEach(slotReset); alGlow(); }
function commit(){
  const picked=SLOTS.filter(L=>$(L+'Country').dataset.v);
  if(!picked.length){ flash($('ACountry')); toast(t('m.errNoTeam'),'err'); return; }
  if(!segVal('mAl')){ flash($('mAl')); toast(t('m.errAl'),'err'); return; }
  if(picked.length===2 && $('ACountry').dataset.v===$('BCountry').dataset.v){ flash($('BCountry')); toast(t('m.errSame'),'err'); return; }
  const other={A:$('BCountry').dataset.v,B:$('ACountry').dataset.v};
  const names=[];
  picked.forEach(L=>{ const o=slotObj(L,other[L]); const i=DB.match.findIndex(x=>x.id===o.id);
    if(i>=0) DB.match[i]=o; else DB.match.push(o); names.push(nFlagTxt(o.team)+' '+nName(o.team)); });
  const m=parseInt($('mMatch').value,10)||0;
  saveNow(); renderMList(); push(true);
  $('mMatch').value=m+1; SLOTS.forEach(slotReset);
  toast(t('m.saved')+' · '+names.join(' + '),'ok'); haptic(18); sparkBurst($('mSave'),16); window.scrollTo({top:0,behavior:'smooth'}); }
$('mSave').onclick=commit;
$('mClear').onclick=()=>{ SLOTS.forEach(slotReset); toast(t('m.clearForm')); };
$('mMatch').addEventListener('input',()=>{ if(EDIT.A||EDIT.B) SLOTS.forEach(slotReset); });
function renderMList(){
  $('mCount').textContent=live().length;
  const rows=live().slice().sort((a,b)=>(b.match-a.match)||String(a.team).localeCompare(String(b.team))).slice(0,40);
  $('mList').innerHTML=rows.length?rows.map(r=>`<div class="it" data-id="${r.id}">
      <div class="n ${r.al}">M${r.match}</div><div class="fl">${nFlag(r.team)}</div>
      <div class="d"><b>${esc(nName(r.team))}</b>${r.phase&&r.phase!=='qual'?`<span class="tag ${r.phase==='play'?'z3':''}">${esc(t(r.phase==='prac'?'m.practice':'m.playoffs'))}</span>`:''}<br><span class="tag">🏀 ${r.sup}</span><span class="tag">PORT ${r.port}</span>${r.climb&&r.climb!=='0'?`<span class="tag ${CLIMB_TAG[r.climb]}">${esc(CLIMB_LABEL[r.climb])}</span>`:''}${r.carry?`<span class="tag">${esc(t('m.carried'))} ${r.carry}</span>`:''}${r.carried?`<span class="tag">${esc(t('m.wasCarried'))}</span>`:''}${r.state&&r.state!=='ok'?`<span class="tag bad">${esc(STATE_LBL[r.state]||r.state)}</span>`:''}${r.card?`<span class="tag bad">${esc(t('m.card'))} ${r.card}</span>`:''}${r.rate?`<span class="tag">${esc(t('n.drv'))} ${r.rate}</span>`:''}</div>
      <div class="x" data-del="${r.id}">✕</div></div>`).join('')
    :`<div class="empty">${esc(t('m.noRecords'))}</div>`;
  $('mList').querySelectorAll('.it').forEach(el=>el.onclick=e=>{
    if(e.target.dataset.del){ if(confirm(t('m.delete'))){ const d=DB.match.find(x=>x.id===e.target.dataset.del); if(d){ d.del=true; d.ts=now(); } saveNow(); renderMList(); push(true); } return; }
    const r=DB.match.find(x=>x.id===el.dataset.id); if(!r) return;
    const mate=live().find(x=>x.id!==r.id&&x.match===r.match&&x.al===r.al);
    $('mMatch').value=r.match; segInit($('mAl'),r.al,alGlow); segInit($('mPhase'),r.phase||'qual',()=>{}); alGlow();
    slotLoad('A',r); slotLoad('B',mate||null);
    window.scrollTo({top:0,behavior:'smooth'}); toast(t('m.editing')+' M'+r.match); }); }

/* ---------- PIT ---------- */
let curTeam='';
function blankPit(){ return {sup:'',cap:0,type:'',empty:0,port:'',climb:'',climbSec:0,carry:false,carried:false,pos:[],roles:[],hp:'',drive:'',lang:[],breaks:0,notes:'',coord:[],scout:'',ts:''}; }
let pitPhase='qual';
/* 一個國家每個賽段一份。qual 沿用原本的 key，所以舊資料自動變成正賽那一份，
   而且 DB.pit 仍然是平的 key->紀錄，同步合併和伺服器都不用改。 */
function pitKey(slug,ph){ ph=ph||pitPhase; return ph==='qual'?slug:slug+'#'+ph; }
function pitSlugOf(key){ return String(key).split('#')[0]; }
function pitPhaseOf(key){ return String(key).split('#')[1]||'qual'; }
/* 找這一國最合適的一份：先要指定賽段，沒有退回正賽，再沒有就挑最新的 */
function pitFor(slug,ph){
  if(!DB) return null;
  const want=DB.pit[pitKey(slug,ph||pitPhase)]; if(want&&want.ts) return want;
  const q=DB.pit[slug]; if(q&&q.ts) return q;
  let best=null;
  Object.entries(DB.pit).forEach(([k,v])=>{ if(pitSlugOf(k)===slug&&v&&v.ts&&(!best||v.ts>best.ts)) best=v; });
  return best;
}
function rec(){ if(!curTeam||!DB) return null; const k=pitKey(curTeam);
  if(!DB.pit[k]) DB.pit[k]=blankPit(); return DB.pit[k]; }
function touch(k,v){ const r=rec(); if(!r) return; r[k]=v; r.ts=now(); r.scout=DB.cfg.scout; save(); showSaved(r.ts); }
function showSaved(ts){
  const el=$('pSaved'); if(!el) return;
  el.textContent = ts ? t('sc.autosaved')+' '+String(ts).replace('T',' ').slice(11,16) : t('sc.nothingYet');
}
/* tappable field map (own alliance drawn on the left, like the official drawing) */
function fieldSVG(){ return `<svg viewBox="0 0 700 700" aria-label="field map">
  <rect class="fld" x="0" y="0" width="700" height="700" rx="6"/>
  <rect class="su r" x="120" y="0" width="150" height="120"/><rect class="ex" x="270" y="0" width="160" height="120"/><rect class="su b" x="430" y="0" width="150" height="120"/>
  <text class="lbl" x="195" y="66">SU</text><text class="lbl" x="350" y="66">EXT</text><text class="lbl" x="505" y="66">SU</text>
  <path class="fs r" d="M0 700 V590 L110 700 Z"/><path class="fs b" d="M700 700 V590 L590 700 Z"/>
  <line class="br r" x1="30" y1="650" x2="270" y2="110"/><line class="br b" x1="670" y1="650" x2="430" y2="110"/>
  <rect class="rz" x="0" y="120" width="50" height="460"/><rect class="rz" x="650" y="120" width="50" height="460"/>
  <g class="zone" data-z="wall"><rect x="0" y="120" width="50" height="460" rx="4"/><text x="25" y="360" transform="rotate(-90 25 360)">${esc(t('p.wall')).toUpperCase()}</text></g>
  <g class="zone" data-z="front"><rect x="120" y="130" width="460" height="100" rx="10"/><text x="350" y="186">${esc(t('p.front')).toUpperCase()}</text></g>
  <g class="zone" data-z="center"><circle cx="350" cy="400" r="115"/><text x="350" y="406">${esc(t('p.center')).toUpperCase()}</text></g>
  <g class="zone" data-z="port"><rect x="0" y="560" width="150" height="140" rx="10"/><text x="75" y="636">PORT</text></g>
  <g class="zone" data-z="brace"><polygon points="10,620 70,670 300,150 240,105"/><text x="155" y="400" transform="rotate(-66 155 400)">${esc(t('p.brace')).toUpperCase()}</text></g>
  <text class="lbl side" x="-350" y="-14" transform="rotate(-90)">◀ ${esc(t('p.ourStation'))}</text>
</svg>`; }
function mountMap(wrapId,chipsId){ const w=$(wrapId); w.innerHTML=fieldSVG();
  w.querySelectorAll('.zone').forEach(z=>z.addEventListener('click',()=>{ const b=$(chipsId).querySelector(`button[data-v="${z.dataset.z}"]`); if(b) b.click(); })); }
function syncMapFor(wrapId,vals){ const set=new Set(vals||[]); $(wrapId).querySelectorAll('.zone').forEach(z=>z.classList.toggle('on',set.has(z.dataset.z))); }
function syncMap(){ syncMapFor('pMapWrap',rec()?(rec().pos||[]):[]); }
function loadPit(){ const on=!!curTeam; $('pitBody').hidden=!on; if(!on) return; const r=rec(); renderSelf(); mountMap('pMapWrap','pPos');
  segInit($('pSup'),r.sup,v=>touch('sup',v)); segInit($('pPort'),r.port,v=>touch('port',v)); segInit($('pClimb'),r.climb,v=>touch('climb',v));
  segInit($('pType'),r.type,v=>touch('type',v)); segInit($('pHP'),r.hp,v=>touch('hp',v)); segInit($('pDrive'),r.drive,v=>touch('drive',v));
  chipsInit($('pPos'),r.pos,v=>{ touch('pos',v); syncMap(); }); syncMap();
  chipsInit($('pRoles'),r.roles,v=>touch('roles',v)); chipsInit($('pLang'),r.lang,v=>touch('lang',v)); chipsInit($('pCoord'),r.coord,v=>touch('coord',v));
  tgInit($('pCarry'),r.carry,v=>touch('carry',v)); tgInit($('pCarried'),r.carried,v=>touch('carried',v));
  $('pCap').value=r.cap||0; $('pEmpty').value=r.empty||0; $('pClimbSec').value=r.climbSec||0; $('pBreak').value=r.breaks||0; $('pNotes').value=r.notes||'';
  scNowRender(); showSaved(r.ts); }
{ const num={pCap:'cap',pEmpty:'empty',pClimbSec:'climbSec',pBreak:'breaks'};
  Object.entries(num).forEach(([id,k])=>$(id).oninput=e=>touch(k,parseInt(e.target.value,10)||0));
  $('pNotes').oninput=e=>touch('notes',e.target.value); }
$('pCountry').onclick=()=>openPicker(sl=>{ curTeam=sl; setCbtn($('pCountry'),sl); loadPit(); haptic(12); });

/* ---------- 賽前打聽：賽程一出來，選這場的兩個盟友，再下去維修區找他們 ---------- */
function plan(){ const p=DB.cfg.plan||(DB.cfg.plan={match:0,a:'',b:'',phase:'qual'}); if(!p.phase) p.phase='qual'; return p; }
function planSave(){ DB.cfg.ts=now(); save(); }
function scWhoRender(){
  const pl=plan(), el=$('scWho'), both=[['A',pl.a],['B',pl.b]].filter(x=>x[1]);
  el.hidden = both.length<2;
  if(el.hidden){ el.innerHTML=''; return; }
  el.innerHTML=both.map(([k,sl])=>`<button data-v="${esc(sl)}"><span class="fl">${nFlag(sl)}</span> ${esc(nName(sl))}</button>`).join('');
  segInit(el, curTeam||pl.a, v=>{ if(!v) return; curTeam=v; setCbtn($('pCountry'),''); loadPit(); haptic(12); });
}
function scPick(slot){
  openPicker(sl=>{
    const pl=plan(); pl[slot.toLowerCase()]=sl; planSave();
    setCbtn($('sc'+slot),sl,t('m.whichCountry'));
    curTeam=sl; setCbtn($('pCountry'),''); loadPit(); scWhoRender(); mPlanBar(); haptic(12);
  });
}
function scLoad(){
  const pl=plan();
  pitPhase=pl.phase||'qual';
  segInit($('scPhase'),pitPhase,v=>{
    pitPhase=v||'qual'; plan().phase=pitPhase; planSave();
    if(curTeam) loadPit();      // 換賽段等於換一份紀錄
    scWhoRender();
  });
  $('scMatch').value=pl.match||1;
  setCbtn($('scA'),pl.a||'',t('m.whichCountry')); setCbtn($('scB'),pl.b||'',t('m.whichCountry'));
  scWhoRender(); mPlanBar();
}
$('scA').onclick=()=>scPick('A'); $('scB').onclick=()=>scPick('B');
$('scMatch').oninput=e=>{ plan().match=parseInt(e.target.value,10)||0; planSave(); mPlanBar(); };
/* 我們自己打過的場次對這一隊的統計，賽前先看一眼 */
function scNowRender(){
  const el=$('scNow'); if(!el) return;
  const b=curTeam?summary(true)[curTeam]:null;
  if(!curTeam||!b||!b.n){ el.hidden=true; el.innerHTML=''; return; }
  const f=(x)=>b.n?(x/b.n).toFixed(1):'—';
  const bits=[
    `<span class="tag">${b.n} ${esc(t('n.matches'))}</span>`,
    `<span class="tag">🏀 ${f(b.sup)}</span>`,
    `<span class="tag">PORT ${f(b.port)}</span>`,
    b.best&&b.best!=='0'?`<span class="tag ${CLIMB_TAG[b.best]}">${esc(CLIMB_LABEL[b.best])}</span>`:`<span class="tag">${esc(t('n.noClimb'))}</span>`,
    `<span class="tag">${esc(t('n.climbs'))} ${Math.round(100*b.climbN/b.n)}%</span>`,
    b.dead?`<span class="tag bad">${esc(t('m.dead'))} ${b.dead}</span>`:''
  ].filter(Boolean).join('');
  el.hidden=false;
  el.innerHTML=`<h2><span class="ic">📊</span>${esc(t('sc.weSaw'))}</h2><div class="lstats-wrap">${bits}</div>`;
}

/* Match 分頁：一鍵把賽前計畫帶進來 */
function mPlanBar(){
  const bar=$('mPlanBar'), btn=$('mUsePlan'); if(!bar||!btn) return;
  const pl=plan(); const ok=!!(pl.a||pl.b);
  bar.hidden=!ok; if(!ok) return;
  const names=[pl.a,pl.b].filter(Boolean).map(nName).join(' · ');
  btn.textContent=`${t('sc.usePlan')} M${pl.match||'?'} · ${names}`;
  btn.onclick=()=>{
    if(pl.match) $('mMatch').value=pl.match;
    if(pl.phase) segInit($('mPhase'),pl.phase,()=>{});
    if(pl.a){ setCbtn($('ACountry'),pl.a,t('m.whichCountry')); $('ABody').hidden=false; }
    if(pl.b){ setCbtn($('BCountry'),pl.b,t('m.whichCountry')); $('BBody').hidden=false; }
    haptic(12); toast(t('sc.planLoaded'),'ok');
  };
}
function pitBits(p){ const bits=[]; if(!p) return bits;
  if(p.cap) bits.push(`${t('n.holds')} ${p.cap}`); if(p.type) bits.push(TYPE_LABEL[p.type]||p.type); if(p.empty) bits.push(`${t('n.empties')} ${p.empty}s`);
  bits.push(`${t('n.dShoot')} ${TRI[p.sup]||'?'}`,`PORT ${TRI[p.port]||'?'}`,`${t('n.dClimb')} ${CLIMB_LABEL[p.climb]||'?'}${p.climbSec?' '+p.climbSec+'s':''}`);
  if(p.carry) bits.push(t('p.canCarry')); if(p.carried) bits.push(t('p.canBeCarried'));
  if((p.pos||[]).length) bits.push('📍 '+p.pos.map(x=>POS_LABEL[x]||x).join('/'));
  if((p.roles||[]).length) bits.push(p.roles.map(x=>ROLE[x]||x).join('/')); if((p.lang||[]).length) bits.push(p.lang.join('/'));
  return bits; }
function pitLine(p,k){ let h='';
  if(p&&p.ts) h+=`<br><span style="font-size:11.5px;opacity:.85">Pit: ${esc(pitBits(p).join(' · '))}</span>`;
  const s=PROFILES[k]; if(s&&s.published) h+=`<br><span style="font-size:11.5px;opacity:.85">📢 ${esc(t('n.legSelf'))}: ${esc(pitBits(s).join(' · '))}</span>`;
  return h; }
/* the scouted team's own published profile, shown above our Pit answers */
function renderSelf(){ const el=$('pSelf'); const s=PROFILES[curTeam]; if(!curTeam||!s||!s.published){ el.hidden=true; el.innerHTML=''; return; }
  el.hidden=false; el.innerHTML=`<h2><span class="ic">📢</span>${esc(t('p.selfBy'))} ${nFlag(curTeam)} ${esc(nName(curTeam))}</h2>
    <div class="note">${esc(pitBits(s).join(' · '))}</div>${s.desc?`<p class="desc">${esc(s.desc)}</p>`:''}
    <div class="bar"><button class="btn" id="pUseSelf">${esc(t('p.copyIn'))}</button><span class="note" style="align-self:center">${esc(t('p.updated'))} ${esc((s.ts||'').slice(0,10))}</span></div>`;
  $('pUseSelf').onclick=()=>{ const r=rec(); ['cap','type','empty','sup','port','climb','climbSec','carry','carried','pos','roles','hp','drive','lang'].forEach(k=>{ if(s[k]!==undefined) r[k]=s[k]; }); r.ts=now(); save(); loadPit(); toast(t('p.copied'),'ok'); }; }

/* ---------- NATIONS ---------- */
let tPhase='all';
function phaseOK(r){ return tPhase==='all' || (r.phase||'qual')===tPhase; }
function summary(allPhases){ const by={};
  const mk=()=>({n:0,sup:0,port:0,best:'',climbN:0,z3:0,carry:0,dead:0,rate:0,rn:0,cards:0});
  live().filter(r=>allPhases||phaseOK(r)).forEach(r=>{ const k=r.team; if(!k) return; const b=by[k]||(by[k]=mk());
    b.n++; b.sup+=r.sup||0; b.port+=r.port||0; if(r.climb&&r.climb!=='0'){ b.climbN++; if(r.climb==='3') b.z3++; }
    if((CLIMB_MULT[r.climb]||0)>(CLIMB_MULT[b.best]||0)) b.best=r.climb;
    b.carry+=r.carry||0; if(r.state==='dead'||r.state==='stuck') b.dead++; if(r.rate){ b.rate+=+r.rate; b.rn++; } if(r.card) b.cards++; });
  Object.keys(DB.pit).forEach(k=>{ const sl=pitSlugOf(k); if(!by[sl]) by[sl]=mk(); });
  Object.keys(PROFILES).forEach(k=>{ if(PROFILES[k].published&&k!==AUTH.team&&!by[k]) by[k]=mk(); });
  return by; }
function renderTeams(){ if(!DB) return; const by=summary(), mode=segVal('tSort')||'sup';
  const av=x=>x.n?x.sup/x.n:-1; const maxAv=Math.max(1,...Object.values(by).map(av));
  const keys=Object.keys(by).sort((a,b)=>{ const A=by[a],B=by[b];
    if(mode==='sup') return av(B)-av(A); if(mode==='climb') return (CLIMB_MULT[B.best]||0)-(CLIMB_MULT[A.best]||0)||av(B)-av(A);
    if(mode==='rel') return (A.n?A.dead/A.n:1)-(B.n?B.dead/B.n:1)||av(B)-av(A); return B.n-A.n; });
  $('tList').innerHTML=keys.length?keys.map((k,i)=>{ const b=by[k],p=pitFor(k); const f=(x,n)=>n?(x/n).toFixed(1):'—';
    return `<div class="it" data-t="${esc(k)}"><div class="n" style="background:var(--line);color:var(--muted)">#${i+1}</div><div class="fl">${nFlag(k)}</div><div class="d"><b>${esc(nName(k))}</b> <span style="font-size:11px">${esc(nSub(k))}</span> · ${b.n} ${esc(t('n.matches'))}${PROFILES[k]&&PROFILES[k].published?` <span class="tag ok">📢 ${esc(t('n.selfTag'))}</span>`:''}
      <div class="meter"><i style="width:${b.n?Math.round(100*av(b)/maxAv):0}%"></i></div>
      <span class="tag">🏀 ${f(b.sup,b.n)}</span><span class="tag">PORT ${f(b.port,b.n)}</span>${b.best&&b.best!=='0'?`<span class="tag ${CLIMB_TAG[b.best]}">${esc(CLIMB_LABEL[b.best])}</span>`:`<span class="tag">${esc(t('n.noClimb'))}</span>`}<span class="tag">${esc(t('n.climbs'))} ${b.n?Math.round(100*b.climbN/b.n):0}%</span>${b.z3?`<span class="tag z3">Z3 ×${b.z3}</span>`:''}${b.carry?`<span class="tag ok">${esc(t('m.carried'))} ${b.carry}</span>`:''}${b.dead?`<span class="tag bad">${esc(t('n.broke'))} ${b.dead}/${b.n}</span>`:''}${b.rn?`<span class="tag">${esc(t('n.drv'))} ${f(b.rate,b.rn)}</span>`:''}${b.cards?`<span class="tag bad">${esc(t('n.cards'))} ${b.cards}</span>`:''}
      ${pitLine(p,k)}</div></div>`; }).join('')
    :`<div class="empty">${esc(t('n.noData'))}</div>`;
  $('tList').querySelectorAll('.it').forEach(el=>el.onclick=()=>openNation(el.dataset.t)); }
segInit($('tSort'),'sup',renderTeams);
segInit($('tPhase'),'all',v=>{ tPhase=v||'all'; renderTeams(); });
$('nLookup').onclick=()=>openPicker(sl=>openNation(sl));
$('pSave').onclick=async()=>{
  if(!curTeam){ toast(t('sc.pickFirst')); return; }
  const r=rec(); if(r&&!r.ts){ r.ts=now(); r.scout=DB.cfg.scout; }
  saveNow();
  toast(t('sc.saved')+' · '+nName(curTeam)+' · '+(PHASE_LABEL[pitPhase]||pitPhase),'ok');
  haptic(18); sparkBurst($('pSave'),16); showSaved(r&&r.ts);
  try{ await push(true); }catch(e){}
};
/* 有公開自介的國家直接列出來，不用先知道要找誰 */
function renderPublished(){
  const el=$('pubList'); if(!el) return;
  const rows=Object.entries(PROFILES||{})
    .filter(([k,v])=>v&&v.published)
    .sort((a,b)=>nName(a[0]).localeCompare(nName(b[0])));
  if(!rows.length){ el.innerHTML=`<div class="empty">${esc(t('sc.pubNone'))}</div>`; return; }
  el.innerHTML=rows.map(([k,v])=>{
    const nph=(v.photos||[]).length;
    const bits=pitBits(v).slice(0,4).join(' · ');
    return `<div class="it" data-t="${esc(k)}"><div class="fl">${nFlag(k)}</div><div class="d">
      <b>${esc(nName(k))}</b>${nph?`<span class="tag">📷 ${nph}</span>`:''}
      <div class="note" style="margin-top:3px">${esc(bits)}</div></div></div>`;
  }).join('');
  el.querySelectorAll('.it').forEach(x=>x.onclick=()=>openNation(x.dataset.t));
}

/* ---------- NATION PAGE (lobby): photos · radar · power · our numbers ---------- */
function dims(p){ if(!p) return null; const tri={'2':5,'1':3,'0':1};
  const any=(p.sup!==''&&p.sup!=null)||p.cap||p.empty||(p.climb&&p.climb!=='0')||p.carry||p.carried||(p.port!==''&&p.port!=null);
  if(!any) return null;
  return {shoot:tri[p.sup]||0, fire:Math.min(5,(p.cap||0)/4), speed:p.empty?Math.max(0,Math.min(5,5-(p.empty-4)/4)):0,
    climb:{'':0,'0':0,'C':2,'1':3,'2':4,'3':5}[p.climb]||0, carry:Math.min(5,(p.carry?4:0)+(p.carried?1:0)), port:tri[p.port]||0}; }
function power(d){ if(!d) return null; const w={shoot:.25,fire:.2,speed:.15,climb:.25,carry:.1,port:.05}; return Math.round(100*Object.keys(w).reduce((s,k)=>s+(d[k]/5)*w[k],0)); }
function radarSVG(a,b){ const N=6,R=92,cx=130,cy=128; const pt=(i,v)=>{ const ang=-Math.PI/2+i*2*Math.PI/N; return [cx+Math.cos(ang)*R*v/5, cy+Math.sin(ang)*R*v/5]; };
  let h='<svg class="radar" viewBox="0 0 260 262">';
  for(const lv of [1,2,3,4,5]) h+=`<polygon class="grid" points="${DIMS.map((d,i)=>pt(i,lv).join(',')).join(' ')}"/>`;
  h+=DIMS.map((d,i)=>{ const [x,y]=pt(i,5); return `<line class="axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join('');
  const poly=(v,cls)=>v?`<polygon class="${cls}" points="${DIMS.map((d,i)=>pt(i,v[d[0]]).join(',')).join(' ')}"/>`+DIMS.map((d,i)=>{ const [x,y]=pt(i,v[d[0]]); return `<circle class="dot ${cls}" cx="${x}" cy="${y}" r="3.5"/>`; }).join(''):'';
  h+=poly(a,'self')+poly(b,'ours');
  h+=DIMS.map((d,i)=>{ const [x,y]=pt(i,6.25); return `<text class="lab" x="${x}" y="${y+4}" text-anchor="middle">${esc(d[1])}</text>`; }).join('');
  return h+'</svg>'; }
let NATION='';
function openNation(slug){ if(!slug||!DB) return; NATION=slug;
  const s=PROFILES[slug]; const self=(s&&s.published)?s:null; const pit=pitFor(slug)||null; const by=summary()[slug];
  const dA=dims(self), dB=dims(pit); const pw=power(dA||dB); const f=(x,n)=>n?(x/n).toFixed(1):'—';
  const photos=(self&&self.photos)||[]; const tier=pw==null?'':pw>=80?'🔥 '+t('n.elite'):pw>=60?'💪 '+t('n.strong'):pw>=40?'👍 '+t('n.solid'):'🌱 '+t('n.dev');
  $('nBody').innerHTML=`
    <div class="nhero"><button class="btn nclose" id="nClose">‹ ${esc(t('n.back'))}</button>
      <div class="nflag">${nFlag(slug)}</div><div class="nname">${esc(nName(slug))}</div>
      <div class="nzh">${esc(nSub(slug))}${self?` · <span class="tag ok">📢 ${esc(t('n.selfTag'))}</span>`:` · <span class="tag">${esc(t('n.notSelf'))}</span>`}</div>
      ${pw!=null?`<div class="npower"><div class="npw">${pw}</div><div class="npl">${esc(t('n.power'))} <b>${esc(tier)}</b></div><div class="meter big"><i style="width:${pw}%"></i></div></div>`:''}
    </div>
    ${photos.length?`<div class="gallery">${photos.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join('')}</div>`:''}
    <div class="card"><h2><span class="ic">📈</span>${esc(t('n.dims'))}</h2>
      ${(dA||dB)?radarSVG(dA,dB)+`<div class="legend">${dA?`<span><i class="self"></i>${esc(t('n.legSelf'))}</span>`:''}${dB?`<span><i class="ours"></i>${esc(t('n.legOurs'))}</span>`:''}</div>`:`<div class="empty">${esc(t('n.noDims'))}</div>`}
    </div>
    <div class="card"><h2><span class="ic">📊</span>${esc(t('n.ourNumbers'))}</h2>
      ${by&&by.n?`<div class="row stats"><div><div class="note">${esc(t('n.matches'))}</div><div class="stat">${by.n}</div></div><div><div class="note">${esc(t('n.ballsPer'))}</div><div class="stat">${f(by.sup,by.n)}</div></div><div><div class="note">${esc(t('n.portPer'))}</div><div class="stat">${f(by.port,by.n)}</div></div><div><div class="note">${esc(t('n.climbRate'))}</div><div class="stat">${Math.round(100*by.climbN/by.n)}%</div></div><div><div class="note">${esc(t('n.best'))}</div><div class="stat" style="font-size:20px">${esc(CLIMB_LABEL[by.best]||'—')}</div></div><div><div class="note">${esc(t('n.breakdowns'))}</div><div class="stat">${by.dead}</div></div></div>`:`<div class="empty">${esc(t('n.notScouted'))}</div>`}
    </div>
    ${self?`<div class="card self"><h2><span class="ic">📢</span>${esc(t('n.words'))}</h2><div class="note">${esc(pitBits(self).join(' · '))}</div>${self.desc?`<p class="desc">${esc(self.desc)}</p>`:''}<p class="note" style="margin-top:8px">${esc(t('p.updated'))} ${esc((self.ts||'').slice(0,10))}</p></div>`:''}
    ${pit&&pit.ts?`<div class="card"><h2><span class="ic">🔧</span>${esc(t('n.pitNotes'))}</h2><div class="note">${esc(pitBits(pit).join(' · '))}</div>${pit.notes?`<p class="desc">${esc(pit.notes)}</p>`:''}</div>`:''}
    <div class="bar" style="padding-bottom:30px"><button class="btn pri" id="nPit">🔧 ${esc(t('n.scoutPit'))}</button><button class="btn" id="nClose2">${esc(t('n.close'))}</button></div>`;
  $('nation').hidden=false; document.body.classList.add('lock'); $('nation').scrollTop=0; haptic(12);
  const close=()=>{ $('nation').hidden=true; document.body.classList.remove('lock'); NATION=''; };
  $('nClose').onclick=close; $('nClose2').onclick=close;
  $('nPit').onclick=()=>{ close(); curTeam=slug; setCbtn($('pCountry'),slug); loadPit(); document.querySelector('nav button[data-tab=pit]').click(); }; }

/* ---------- OUR ROBOT (public profile, shared with every team) ---------- */
let PROFILES={}; try{ PROFILES=JSON.parse(localStorage.getItem('fgc2026.profiles')||'{}')||{}; }catch(e){ PROFILES={}; }
function robot(){ if(!DB.robot) DB.robot=Object.assign(blankPit(),{desc:'',published:false}); return DB.robot; }
function rtouch(k,v){ const r=robot(); r[k]=v; r.dirty=true; save(); updateRobotBtn(); }
function updateRobotBtn(){ const r=robot(); $('rSave').textContent=r.published?t('r.savePub'):t('r.savePriv');
  $('rStatus').textContent=r.dirty?t('r.unsaved'):(r.ts?t('r.savedAt')+' '+String(r.ts).slice(0,16).replace('T',' ')+' · '+(r.published?t('r.visible'):t('r.private')):t('r.notSaved'));
  /* filled it in but never flipped the switch — say so loudly instead of leaving it private by accident */
  $('rNudge').hidden=!(r.ts&&!r.published&&!AUTH.offline); }
$('rNudgeGo').onclick=()=>{ const r=robot(); r.published=true; r.dirty=true; $('rPub').setAttribute('aria-pressed','true'); saveProfile(true); };
function robotLoad(){ const r=robot(); mountMap('rMapWrap','rPos');
  segInit($('rSup'),r.sup,v=>rtouch('sup',v)); segInit($('rPort'),r.port,v=>rtouch('port',v)); segInit($('rClimb'),r.climb,v=>rtouch('climb',v));
  segInit($('rType'),r.type,v=>rtouch('type',v)); segInit($('rHP'),r.hp,v=>rtouch('hp',v)); segInit($('rDrive'),r.drive,v=>rtouch('drive',v));
  chipsInit($('rPos'),r.pos,v=>{ rtouch('pos',v); syncMapFor('rMapWrap',v); }); syncMapFor('rMapWrap',r.pos);
  chipsInit($('rRoles'),r.roles,v=>rtouch('roles',v)); chipsInit($('rLang'),r.lang,v=>rtouch('lang',v));
  tgInit($('rCarry'),r.carry,v=>rtouch('carry',v)); tgInit($('rCarried'),r.carried,v=>rtouch('carried',v));
  /* publishing is the thing people forget to save — toggle it and it uploads right away */
  tgInit($('rPub'),r.published,v=>{ rtouch('published',v); saveProfile(true); });
  $('rCap').value=r.cap||0; $('rEmpty').value=r.empty||0; $('rClimbSec').value=r.climbSec||0; $('rDesc').value=r.desc||''; updateRobotBtn(); renderPhotos(); }
/* robot photos: shrunk on-device to ≤1280px JPEG, then uploaded */
function renderPhotos(){ const r=robot(); const ph=(PROFILES[AUTH.team]&&PROFILES[AUTH.team].photos)||r.photos||[]; r.photos=ph;
  $('rPhotos').innerHTML=ph.map(u=>`<div class="ph"><img src="${esc(u)}" alt=""><button class="x" data-u="${esc(u)}" aria-label="delete">✕</button></div>`).join('')||`<div class="empty" style="padding:12px">${esc(t('r.noPhotos'))}</div>`;
  $('rPhotos').querySelectorAll('.x').forEach(b=>b.onclick=async()=>{ if(!confirm(t('r.delPhoto'))) return;
    try{ const d=await api('/api/photo/delete',{url:b.dataset.u}); (PROFILES[AUTH.team]||(PROFILES[AUTH.team]={})).photos=d.photos; r.photos=d.photos; saveNow(); renderPhotos(); toast(t('r.deleted'),'ok'); }
    catch(e){ toast(e.message,'err'); } });
  $('rFileBtn').classList.toggle('dis',ph.length>=4||AUTH.offline); }
function shrink(file){ return new Promise((res,rej)=>{ const img=new Image(); const u=URL.createObjectURL(file);
  img.onload=()=>{ const s=Math.min(1,1280/Math.max(img.width,img.height)); const w=Math.round(img.width*s),h=Math.round(img.height*s);
    const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg',.82)); };
  img.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error('Cannot read this image')); }; img.src=u; }); }
$('rFile').onchange=async e=>{ const files=[...(e.target.files||[])]; e.target.value=''; if(!files.length) return;
  if(AUTH.offline){ toast(t('r.localCant'),'err'); return; }
  for(const f of files){ const r=robot(); if((r.photos||[]).length>=4){ toast(t('r.max'),'err'); break; }
    try{ toast(t('r.uploading')); const data=await shrink(f); const d=await api('/api/photo',{data}); r.photos=d.photos; (PROFILES[AUTH.team]||(PROFILES[AUTH.team]={})).photos=d.photos; saveNow(); renderPhotos(); toast(t('r.added'),'ok'); haptic(14); }
    catch(err){ toast(err.message,'err'); } } };
{ const num={rCap:'cap',rEmpty:'empty',rClimbSec:'climbSec'}; Object.entries(num).forEach(([id,k])=>$(id).oninput=e=>rtouch(k,parseInt(e.target.value,10)||0));
  $('rDesc').oninput=e=>rtouch('desc',e.target.value); }
async function saveProfile(quiet){ const r=robot();
  if(AUTH.offline){ r.ts=now(); r.dirty=false; saveNow(); updateRobotBtn(); toast(t('r.localSaved'),'ok'); return; }
  $('rSave').disabled=true;
  try{ const d=await api('/api/profile',r); Object.assign(r,d); r.dirty=false; saveNow(); PROFILES[AUTH.team]=d; updateRobotBtn(); haptic(18);
    toast(d.published?t('r.published'):t('r.savedTeam'),'ok'); if(d.published) sparkBurst($('rSave'),14); }
  catch(e){ toast(e.message,'err'); }
  finally{ $('rSave').disabled=false; } }
$('rSave').onclick=()=>saveProfile(false);
async function loadProfiles(){ if(AUTH.offline||!AUTH.token||!DB) return;
  try{ PROFILES=await api('/api/profiles'); try{ localStorage.setItem('fgc2026.profiles',JSON.stringify(PROFILES)); }catch(e){}
    /* only adopt the server copy when this device has nothing yet — never clobber local edits */
    const mine=PROFILES[AUTH.team];
    if(mine&&!DB.robot){ DB.robot=Object.assign(blankPit(),{desc:'',published:false},mine); saveNow(); if(!$('tab-robot').hidden) robotLoad(); }
    else if(mine&&DB.robot){ DB.robot.photos=mine.photos||DB.robot.photos||[]; if(!$('tab-robot').hidden) renderPhotos(); }
    renderPublished();
    if(!$('tab-teams').hidden&&rMode==='teams') renderTeams(); if(!$('tab-pit').hidden&&curTeam) renderSelf(); }
  catch(e){} }
setInterval(loadProfiles,60000);

/* ---------- CALC ---------- */
function calc(){ const sup=parseInt($('cSup').value,10)||0, ext=parseInt($('cExt').value,10)||0;
  const m=['cR1','cR2','cR3'].reduce((s,id)=>s+(CLIMB_MULT[segVal(id)]||0),0);
  const partner=25*(parseInt(segVal('cPartner')||'0',10)); const coop={'':0,'0':0,'4':10,'5':25,'6':40}[segVal('cCoop')]||0;
  const supPts=Math.ceil(sup*(1+m)); const total=supPts+partner+ext+coop;
  $('cOut').innerHTML=`<b>SUPPRESSION</b><span>${sup} × (1 + ${m.toFixed(2)}) = <b style="color:var(--ink);font-size:15px">${supPts}</b></span><b>PARTNER CLIMB</b><span>${partner}</span><b>EXTINGUISHER</b><span>${ext}</span><b>COOPERTITION</b><span>${coop}</span>`;
  const el=$('cTotal'); if(el.textContent!==String(total)){ el.textContent=total; if(!RM){ el.style.animation='none'; void el.offsetWidth; el.style.animation='pop .3s var(--e-b)'; } } }
['cR1','cR2','cR3','cPartner','cCoop'].forEach(id=>segInit($(id),'0',calc));
['cSup','cExt'].forEach(id=>$(id).oninput=calc);

/* ---------- DATA TAB ---------- */
function showLastLogin(){
  const el=$('lastLogin'); if(!el) return;
  const p=LAST_LOGIN;
  if(!p||!p.t){ el.hidden=true; return; }
  el.hidden=false;
  el.textContent=t('auth.prevLogin')+' '+String(p.t).replace('T',' ').slice(0,16)+(p.ip?'  ('+p.ip+')':'');
}
function refreshData(){ if(!DB) return; showLastLogin(); $('statPit').textContent=Object.keys(DB.pit).length; $('statMatch').textContent=live().length;
  const s=new Set(Object.keys(DB.pit).map(pitSlugOf)); live().forEach(m=>m.team&&s.add(m.team)); $('statTeams').textContent=s.size;
  $('cfgScout').value=DB.cfg.scout; segInit($('cfgTheme'),DB.cfg.theme,v=>{ DB.cfg.theme=v||'auto'; applyTheme(); touchCfg(); });
  segInit($('cfgFx'),fxMode(),v=>{ DB.cfg.fx=v||'auto'; try{ localStorage.setItem('fgc.fx',DB.cfg.fx); }catch(e){} applyFX(); touchCfg(); }); }
$('cfgScout').oninput=e=>{ DB.cfg.scout=e.target.value; touchCfg(); };
function csv(rows){ return '﻿'+rows.map(r=>r.map(c=>{ const s=String(c==null?'':c); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',')).join('\r\n'); }
function show(text,name,type){ $('out').value=text; const a=$('dlOut'); try{ a.href=URL.createObjectURL(new Blob([text],{type:type||'text/csv;charset=utf-8'})); a.download=name; }catch(e){} $('out').scrollIntoView({behavior:'smooth',block:'center'}); }
$('expMatch').onclick=()=>{ const rows=[['Scout','Match','Team','Alliance','Partner 1','Partner 2','Suppression balls','Port balls','Climb','Partners carried','Was carried','Climb start (s left)','Status','Card','Driver','Notes','Time']];
  live().sort((a,b)=>a.match-b.match||nName(a.team).localeCompare(nName(b.team))).forEach(r=>rows.push([r.scout||DB.cfg.scout,r.match,nName(r.team),r.al==='R'?'Red':'Blue',nName(r.p1),nName(r.p2),r.sup,r.port,CLIMB_LABEL[r.climb]||'',r.carry||0,r.carried?'Yes':'',r.climbAt,r.state,r.card,r.rate,r.notes,r.ts])); show(csv(rows),'fgc_match.csv'); };
$('expPit').onclick=()=>{ const rows=[['Scout','Team','Phase','Capacity','Shooter type','Empty full load s','Suppression','Port','Best climb','Climb s','Can carry','Can be carried','Field position','Roles','HP skill','Drivetrain','Languages','Breakdowns','Notes','Time']];
  Object.entries(DB.pit).forEach(([k,p])=>rows.push([p.scout||'',nName(pitSlugOf(k)),PHASE_LABEL[pitPhaseOf(k)]||pitPhaseOf(k),p.cap,TYPE_LABEL[p.type]||'',p.empty,TRIL[p.sup],TRIL[p.port],CLIMB_LABEL[p.climb]||'',p.climbSec,p.carry?'Yes':'',p.carried?'Yes':'',(p.pos||[]).map(x=>POS_LABEL[x]||x).join('/'),(p.roles||[]).map(x=>ROLE[x]||x).join('/'),p.hp,p.drive,(p.lang||[]).join('/'),p.breaks,p.notes,p.ts])); show(csv(rows),'fgc_pit.csv'); };
$('expSum').onclick=()=>{ const by=summary(); const f=(x,n)=>n?(x/n).toFixed(1):'';
  const rows=[['Team','Matches','Avg suppression','Avg port','Best climb','Climb %','Z3 count','Partners carried','Breakdowns','Avg driver','Pit capacity','Shooter type','Empty s','Pit shoot','Pit climb','Field position','Roles','Languages']];
  Object.keys(by).sort((a,b)=>(by[b].n?by[b].sup/by[b].n:-1)-(by[a].n?by[a].sup/by[a].n:-1)).forEach(k=>{ const b=by[k],p=pitFor(k)||{};
    rows.push([nName(k),b.n,f(b.sup,b.n),f(b.port,b.n),CLIMB_LABEL[b.best]||'',b.n?Math.round(100*b.climbN/b.n)+'%':'',b.z3,b.carry,b.dead,f(b.rate,b.rn),p.cap||'',TYPE_LABEL[p.type]||'',p.empty||'',TRIL[p.sup]||'',CLIMB_LABEL[p.climb]||'',(p.pos||[]).map(x=>POS_LABEL[x]||x).join('/'),(p.roles||[]).map(x=>ROLE[x]||x).join('/'),(p.lang||[]).join('/')]); }); show(csv(rows),'fgc_summary.csv'); };
$('expJson').onclick=()=>show(JSON.stringify(DB),'fgc_backup_'+AUTH.team+'.json','application/json');
$('copyOut').onclick=()=>{ const ta=$('out'); ta.removeAttribute('readonly'); ta.select(); ta.setSelectionRange(0,999999); let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} ta.setAttribute('readonly','');
  if(navigator.clipboard&&!ok) navigator.clipboard.writeText(ta.value).then(()=>toast(t('d.copied'),'ok')).catch(()=>toast(t('d.longPress'),'err')); else toast(ok?t('d.copied'):t('d.longPress'),ok?'ok':'err'); };
function doImport(replace){ let d; try{ d=JSON.parse($('impBox').value); }catch(e){ toast(t('d.invalid'),'err'); return; } if(!d||typeof d!=='object') return;
  if(replace) DB=norm(d); else { d=norm(d); Object.entries(d.pit).forEach(([k,v])=>{ const c=DB.pit[k]; if(!c||(v.ts||'')>(c.ts||'')) DB.pit[k]=v; }); Object.assign(DB.cfg.custom,d.cfg.custom||{});
    const ids=new Set(DB.match.map(m=>m.id)); d.match.forEach(m=>{ if(!ids.has(m.id)) DB.match.push(m); }); }
  saveNow(); applyTheme(); loadPit(); renderMList(); refreshData(); $('impBox').value=''; toast(t('d.imported'),'ok'); push(true); }
$('impMerge').onclick=()=>doImport(false); $('impReplace').onclick=()=>{ if(confirm(t('d.confirmReplace'))) doImport(true); };
$('wipeMatch').onclick=()=>{ if(confirm(t('d.confirmClearMatch'))){ DB.match.forEach(m=>{ m.del=true; m.ts=now(); }); saveNow(); renderMList(); refreshData(); push(true); } };
$('wipeAll').onclick=()=>{ if(confirm(t('d.confirmClearAll'))){ DB=norm({}); saveNow(); applyTheme(); curTeam=''; setCbtn($('pCountry'),''); $('pitBody').hidden=true; renderMList(); refreshData(); } };

/* ---------- UX ---------- */
function haptic(ms){ try{ navigator.vibrate&&!RM&&navigator.vibrate(ms||8); }catch(e){} }
function toast(msg,kind,ms){ const host=$('toast'); const d=document.createElement('div'); d.textContent=msg; if(kind) d.className=kind; host.appendChild(d);
  setTimeout(()=>{ d.style.transition='opacity .25s,transform .25s'; d.style.opacity='0'; d.style.transform='translateY(10px) scale(.96)'; setTimeout(()=>d.remove(),260); },ms||1500); }
document.addEventListener('pointerdown',e=>{ if(RM) return; const el=e.target.closest('button,.btn,.tg,.it,.sync,.cbtn,.c,.team'); if(!el||el.disabled) return;
  el.classList.add('rp'); const r=el.getBoundingClientRect(), d=Math.max(r.width,r.height); const s=document.createElement('span'); s.className='rip';
  s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`; el.appendChild(s); setTimeout(()=>s.remove(),560); },{passive:true});
document.addEventListener('pointerdown',e=>{ const el=e.target.closest('button,.tg,.it,.sync,.cbtn,.zone'); if(el&&!el.disabled) haptic(e.target.closest('.step button')?6:10); },{passive:true});
document.addEventListener('input',e=>{ const i=e.target; if(i.matches('.step input')&&!RM){ i.classList.remove('bump'); void i.offsetWidth; i.classList.add('bump'); } },{passive:true});
function flash(el){ if(!el||RM) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

/* ---------- SYNC (per team, token auth)
   Sends the payload only when this device has changes; otherwise polls with {rev} and the
   server answers "nochange". Push is near-instant after an edit, idle poll is every 30 s. */
function setSync(k,c,extra){ SYNC.last={k,c:c||'',extra:extra||''}; const e=$('syncBadge'); e.textContent=t(k)+(extra||''); e.className='sync '+(c||''); }
function applyServer(s){ let ch=false; const sc=s.cfg||{}; SYNC.applying=true; try{
  if(sc.ts&&sc.ts>(DB.cfg.ts||'')){ const keep={scout:DB.cfg.scout,theme:DB.cfg.theme,recent:DB.cfg.recent}; DB.cfg=Object.assign(norm({cfg:sc}).cfg,keep); ch=true; }
  Object.entries(s.pit||{}).forEach(([k,v])=>{ const c=DB.pit[k]; if(!c||(v.ts||'')>(c.ts||'')){ DB.pit[k]=v; ch=true; } });
  const idx={}; DB.match.forEach((m,i)=>{ if(m.id) idx[m.id]=i; });
  (s.match||[]).forEach(m=>{ if(!m.id) return; if(idx[m.id]===undefined){ idx[m.id]=DB.match.length; DB.match.push(m); ch=true; } else if((m.ts||'')>(DB.match[idx[m.id]].ts||'')){ DB.match[idx[m.id]]=m; ch=true; } });
  if(!ch) return; saveNow(); renderMList();
  const typing=/^(INPUT|TEXTAREA)$/.test((document.activeElement||{}).tagName||'');
  if(!typing){ if(!$('tab-data').hidden) refreshData(); if(!$('tab-teams').hidden&&rMode==='teams') renderTeams(); if(!$('tab-pit').hidden&&curTeam) loadPit(); }
  } finally { SYNC.applying=false; } }
function stamp(){ return ' '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
async function push(force){ if(!SYNC.on||SYNC.busy||!DB) return;
  const due=Date.now()-SYNC.lastPoll>=SYNC.POLL;
  if(!force&&!SYNC.dirty&&!due) return;
  // 切到背景就不再空轉輪詢（有未上傳的資料還是會送）；回到前景時 visibilitychange 會補一次
  if(!force&&!SYNC.dirty&&document.hidden) return;
  const sending=SYNC.dirty||force;
  SYNC.busy=true; $('syncBadge').classList.add('busy');
  const body=sending?{rev:SYNC.rev,cfg:{custom:DB.cfg.custom,event:DB.cfg.event,ts:DB.cfg.ts},pit:DB.pit,match:DB.match}:{rev:SYNC.rev};
  try{ const ctl=new AbortController(), to=setTimeout(()=>ctl.abort(),12000);
    const r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Token':AUTH.token},signal:ctl.signal,body:JSON.stringify(body)});
    clearTimeout(to);
    if(r.status===401){ signedOut(); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d=await r.json();
    if(sending) SYNC.dirty=false;             // 送出成功才清旗標，失敗下次重送
    SYNC.lastPoll=Date.now();
    if(typeof d.rev==='number') SYNC.rev=d.rev;
    if(!d.nochange) applyServer(d);
    setSync('s.synced','ok',stamp()); }
  catch(e){ if(SYNC.on) setSync('s.offline','bad'); }
  finally{ SYNC.busy=false; $('syncBadge').classList.remove('busy'); } }
setInterval(()=>push(false),4000);
window.addEventListener('online',()=>push(true)); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) push(true); });
$('syncBadge').onclick=()=>push(true);

/* ---------- embers / sparks (Igniting Innovation) ---------- */
function embers(){
  const bg=$('bg'); if(!bg) return;
  bg.querySelectorAll('.sp').forEach(e=>e.remove());
  if(RM) return;
  const light=!matchMedia('(prefers-color-scheme:dark)').matches;
  const N=window.innerWidth<500?22:30;
  for(let i=0;i<N;i++){
    const s=document.createElement('span'); s.className='sp';
    const big=Math.random()<0.18;                       // 少數幾顆大火星
    const sz=big?(5+Math.random()*4):(2+Math.random()*3);
    s.style.cssText=`left:${(Math.random()*100).toFixed(1)}%;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;`+
      `--dx:${(Math.random()*140-70).toFixed(0)}px;--sp-op:${light?(big?.7:.5):(big?1:.85)};`+
      `--dur:${(big?18+Math.random()*10:9+Math.random()*10).toFixed(1)}s;--fd:${(.7+Math.random()*1.4).toFixed(2)}s;`+
      `animation-delay:${(-Math.random()*22).toFixed(1)}s,${(-Math.random()*2).toFixed(1)}s`;
    bg.appendChild(s);
  }
}
/* 存檔成功時從按鈕噴出火花 */
function sparkBurst(el,n){
  if(RM||!el) return;
  const r=el.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
  const count=n||14;
  for(let i=0;i<count;i++){
    const p=document.createElement('span'); p.className='spark';
    const ang=(-Math.PI/2)+(Math.random()-.5)*Math.PI*1.15;   // 往上噴的扇形
    const dist=50+Math.random()*110, sz=4+Math.random()*5;
    p.style.cssText=`left:${cx}px;top:${cy}px;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;`+
      `--sx:${(Math.cos(ang)*dist).toFixed(0)}px;--sy:${(Math.sin(ang)*dist).toFixed(0)}px;`+
      `--sd:${(520+Math.random()*420).toFixed(0)}ms`;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),1000);
  }
}
/* auto = 跟隨系統；on = 強制開啟；off = 全部靜止 */
function fxMode(){ try{ return localStorage.getItem('fgc.fx')||(DB&&DB.cfg.fx)||'auto'; }catch(e){ return (DB&&DB.cfg.fx)||'auto'; } }
function applyFX(){
  const mode=fxMode();
  RM = mode==='off' ? true : (mode==='on' ? false : RM_SYS);
  const el=document.documentElement;
  el.classList.toggle('no-fx', mode==='off');
  el.classList.toggle('fx-on', mode==='on');
  embers();
}
window.addEventListener('resize',(()=>{ let t; return ()=>{ clearTimeout(t); t=setTimeout(embers,400); }; })());

/* ---------- animated tab icon: the official logo with a breathing glow ---------- */
(function animFavicon(){ if(RM||!HTTP) return; const link=document.querySelector('link[rel="icon"][sizes="64x64"]'); if(!link) return;
  const img=new Image(); img.src='fgc2026-192.png';
  img.onload=()=>{ try{ const base=document.createElement('canvas'); base.width=base.height=56; const b=base.getContext('2d');
      b.beginPath(); if(b.roundRect) b.roundRect(0,0,56,56,14); else b.rect(0,0,56,56); b.clip(); b.drawImage(img,0,0,56,56);
      const frames=[]; const c=document.createElement('canvas'); c.width=c.height=64; const ctx=c.getContext('2d');
      for(let i=0;i<14;i++){ const g=0.5+0.5*Math.sin(i/14*2*Math.PI); ctx.clearRect(0,0,64,64); ctx.save();
        ctx.shadowColor=`rgba(255,106,26,${0.3+0.6*g})`; ctx.shadowBlur=3+9*g; ctx.translate(32,32); const s=1+0.05*g; ctx.scale(s,s); ctx.drawImage(base,-28,-28); ctx.restore(); frames.push(c.toDataURL('image/png')); }
      let i=0; setInterval(()=>{ if(document.hidden) return; link.href=frames[i=(i+1)%frames.length]; },150); }catch(e){} }; })();

/* ---------- offline cache (needs https or localhost; silently skipped otherwise) ---------- */
(function(){ if(!('serviceWorker' in navigator)||!HTTP) return;
  const sw=navigator.serviceWorker;
  const hadController=!!sw.controller;   // 第一次造訪是 null，不算更新
  let reloading=false;
  // 新的 worker 接手 = 有新版了。存檔再重載，不然使用者會一直卡在舊版。
  sw.addEventListener('controllerchange',()=>{
    if(!hadController||reloading) return; reloading=true;
    try{ saveNow(); }catch(e){}
    try{ toast(t('s.updating')); }catch(e){}
    setTimeout(()=>location.reload(),900);
  });
  window.addEventListener('load',()=>{ sw.register('sw.js',{scope:'./'})
    .then(r=>{
      const ask=()=>{ try{ r.update(); }catch(e){} };
      r.addEventListener&&r.addEventListener('updatefound',()=>{ const w=r.installing; if(!w) return;
        w.addEventListener('statechange',()=>{ if(w.state==='installed'&&sw.controller) w.postMessage('skipWaiting'); }); });
      if(r.waiting&&sw.controller) r.waiting.postMessage('skipWaiting');
      // 回到前景就問一次有沒有新版（iOS 主畫面 App 會直接從快照喚醒，不會重新載入）
      document.addEventListener('visibilitychange',()=>{ if(!document.hidden) ask(); });
      setInterval(ask,30*60*1000);
    })
    .catch(()=>{}); }); })();

/* ---------- 版本號：讓使用者一眼看出裝到哪一版 ---------- */
const APP_VER='v24';
(function(){ const el=$('appVer'); if(el) el.textContent=APP_VER;
  const b=$('verCheck'); if(!b) return;
  b.onclick=async e=>{ e.preventDefault();
    try{
      if('serviceWorker' in navigator){ const r=await navigator.serviceWorker.getRegistration(); if(r) await r.update(); }
      const res=await fetch('sw.js?ts='+Date.now(),{cache:'no-store'});
      const m=(await res.text()).match(/fgc2026-(v\d+)/);
      if(m&&m[1]!==APP_VER){ toast(t('s.updating')); saveNow(); setTimeout(()=>location.reload(true),900); }
      else toast(t('s.upToDate'),'ok');
    }catch(err){ toast(t('s.offline')); }
  }; })();

/* ---------- init ---------- */
/* 主辦方發的一鍵認領連結：?claim=<slug>&code=<CODE>
   帶進畫面後立刻把網址清乾淨，免得留在網址列或被截圖傳出去。 */
function claimFromURL(){
  try{
    const q=new URLSearchParams(location.search);
    const tm=(q.get('claim')||'').trim().toLowerCase(), code=(q.get('code')||'').trim();
    if(!tm||!NMAP[tm]) return null;
    history.replaceState(null,'',location.pathname);
    return {team:tm,code:code};
  }catch(e){ return null; }
}

(async function init(){
  window.addEventListener('pagehide',saveNow); window.addEventListener('beforeunload',saveNow);
  applyLang(); applyFX();
  if(!HTTP&&$('cInstall')) $('cInstall').hidden=true;
  const invite=claimFromURL();
  const last=(()=>{ try{ return localStorage.getItem('fgc.team')||''; }catch(e){ return ''; } })();
  if(!HTTP){ AUTH.offline=true; setSync('s.local'); if(last&&NMAP[last]) setCbtn($('aTeamOff'),last,t('auth.selectCountry')); showAuth('authOffline'); return; }
  setSync('s.connecting');
  try{ const a=JSON.parse(localStorage.getItem('fgc.auth')||'null');
    if(a&&a.token){ AUTH.token=a.token; const me=await api('/api/me'); AUTH.team=me.team;
      if(me.mustChange&&!skipped(me.team)){ showAuth('authSet'); } else boot(me.team); return; } }
  catch(e){}
  if(invite){
    CLAIMING=invite.team;
    setCbtn($('aTeam'),invite.team,t('auth.selectCountry'));
    setSync('s.notSigned');
    showClaim(invite.team);
    if(invite.code){ $('aCode').value=invite.code; setTimeout(()=>$('aCNew').focus(),250); }
    return;
  }
  if(last&&NMAP[last]) setCbtn($('aTeam'),last,t('auth.selectCountry'));
  setSync('s.notSigned'); showAuth('authLogin');
})();
