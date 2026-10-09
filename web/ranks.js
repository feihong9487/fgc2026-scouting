'use strict';
/* FGC 2026 Scouting — live ladder / match history / analytics, fed by results.first.global */

const OFF = { data: null, movement: {}, spark: {}, fetched: '', error: '', demo: false, timer: 0 };
let rMode = 'ladder';        // ladder | matches | teams
let rCont = 'all';           // all | af | am | as | eu | oc | mine
let rMatchFilter = 'all';    // all | mine | played | next

/* ---------- helpers ---------- */
const CONT_NAMES = window.CONTINENTS || {};
/* 官方用 3 碼國碼 (TPE/JPN)，我們用 slug；靠國名與 ISO-2 兜起來 */
const BY_NAME = {}, BY_CC = {}, BY_WORDS = {};
/* 標點和大小寫都不算數：「Korea, Republic of」跟「Republic of Korea」要能兜在一起 */
const nkey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nwords = s => nkey(s).split(' ').filter(Boolean).sort().join(' ');
NATIONS.forEach(n => {
  [n.name].concat(n.alt || []).forEach(a => {
    const k = nkey(a); if (k && !(k in BY_NAME)) BY_NAME[k] = n;
    const w = nwords(a); if (!w) return;
    BY_WORDS[w] = (w in BY_WORDS && BY_WORDS[w] !== n) ? null : n;   // 兩國撞同一組詞就作廢
  });
  if (n.cc) BY_CC[n.cc.toLowerCase()] = n;
});
function nationOf(row) {
  const t = (row && row.team) || {};
  const cc2 = (t.countryCode || '').toLowerCase();
  if (cc2.length === 2 && BY_CC[cc2]) return BY_CC[cc2];
  const raw = t.country || t.shortName || t.name || '';
  const k = nkey(raw);
  if (BY_NAME[k]) return BY_NAME[k];
  const w = nwords(raw);
  if (w && BY_WORDS[w]) return BY_WORDS[w];
  /* 以前這裡做 substring 寬鬆比對，207 國裡有 10 個會配錯人：
     Romania→Oman、Somalia→Mali、Nigeria→Niger、Sudan→South Sudan、DR Congo→Congo…
     認不出來就回 null，畫面會顯示官方原名 —— 寧可陌生，也不要掛上別國的國旗。 */
  return null;
}
function rowSlug(row) { const n = nationOf(row); return n ? n.slug : ''; }

/* teamKey 是三碼（TWN、MLT…），直接砍前兩碼會出事：MLT 是馬爾他，ML 是馬利。
   排名資料裡每一列同時有 teamKey 和國家，所以對照表直接從資料本身建。 */
const KEY2SLUG = {};
function buildKeyMap() {
  const add = (key, n) => { if (key && n) KEY2SLUG[String(key).toUpperCase()] = n.slug; };
  ((OFF.data && OFF.data.rankings) || []).forEach(r => add(r.teamKey, nationOf(r)));
  /* 賽程通常比排名早公布。participants 身上如果帶得出國家就先建進來，
     不然排名還沒出來的那幾天，整張賽程都對不到隊伍。 */
  ((OFF.data && OFF.data.matches) || []).forEach(m => (m.participants || []).forEach(p => {
    const k = String((p && p.teamKey) || '').toUpperCase();
    if (!k || KEY2SLUG[k]) return;
    add(k, nationOf(p && p.team ? p : { team: p }));
  }));
}
function slugOfKey(k) {
  /* 查不到就回空字串。以前這裡把三碼砍成兩碼當 ISO-2 猜，21 個常見碼裡有 7 個會猜錯：
     CHN→瑞士、CHL→瑞士、MLT→馬利、COD/COG→哥倫比亞、GNB→幾內亞。
     賽程配錯國家，就是派人去打聽錯的隊伍 —— 寧可查不到。 */
  return KEY2SLUG[String(k || '').toUpperCase()] || '';
}
/* 官方的 station 是兩位數：十位 1 = 紅、2 = 藍，個位是第幾台（11、12、13 / 21、22、23）。
   以前這裡只認 'R…' / 'B…'，拿到數字會直接丟錯，整個賽程列表就畫不出來。 */
function allianceOf(st) {
  const c = String(st == null ? '' : st).toUpperCase().charAt(0);
  return c === '1' || c === 'R' ? 'R' : c === '2' || c === 'B' ? 'B' : '';
}
/* 一台機器人的爬升（官方 BraceState：0 / .05 / .1 / .2 / .3）→ CLIMB_LABEL / CLIMB_TAG 的代碼 */
function braceCode(v) {
  if (v == null || v === '') return '';
  const x = Math.round(+v * 100);
  return x >= 30 ? '3' : x >= 20 ? '2' : x >= 10 ? '1' : x >= 5 ? 'C' : '0';
}
function braceTag(v) {
  const c = braceCode(v);
  if (!c) return '';
  if (c === '0') return `<span class="tag">${esc(t('n.offNoClimb'))}</span>`;
  return `<span class="tag ${CLIMB_TAG[c]}">${esc(CLIMB_LABEL[c])} +${(+v).toFixed(2)}</span>`;
}
const multTxt = v => (v ? '×' + (+v).toFixed(2) : '');
/* 季後賽的 id 會從 1 重新算，所以一場比賽要用「賽段 + id」才認得出來 */
const matchKey = m => (m.tournamentKey || '') + ':' + (m.id ?? '');
const matchShort = nm => String(nm || '').replace(/^Ranking Match\s*/i, 'M');
function rowLabel(row) {
  const n = nationOf(row), t = (row && row.team) || {};
  const name = n ? nName(n.slug) : (t.country || t.shortName || t.name || row.teamKey || '—');
  return { flag: n ? nFlag(n.slug) : '🏳️', name, sub: n ? nSub(n.slug) : '', cont: n ? n.cont : '' };
}
/* ---------- 遊戲式段位 ----------
   名次切線：前 3 王者、4–12 大師、13–24 鑽石（季後賽線就在 24）、25–48 白金、49–90 黃金、
   91–135 白銀，其餘青銅；一場正式比賽都還沒打的是「定級中」。鑽石以下每個段位再分 IV→I 四個小段。 */
const PLAYOFF_CUT = 24;
const TIERS = [
  { k: 'chal', lo: 1, hi: 3 }, { k: 'master', lo: 4, hi: 12 }, { k: 'dia', lo: 13, hi: 24 },
  { k: 'plat', lo: 25, hi: 48 }, { k: 'gold', lo: 49, hi: 90 }, { k: 'silver', lo: 91, hi: 135 },
  { k: 'bronze', lo: 136, hi: Infinity },
];
const DIVS = ['I', 'II', 'III', 'IV'];
function tierSpan(T, total) { return { lo: T.lo, hi: T.hi === Infinity ? Math.max(T.lo, total || T.lo) : T.hi }; }
function divOf(T, rank, total) {
  if (T.k === 'chal' || T.k === 'master') return 0;
  const { lo, hi } = tierSpan(T, total), span = hi - lo + 1;
  if (span < 4) return 0;
  return 1 + Math.min(3, Math.floor((rank - lo) / Math.ceil(span / 4)));
}
function tier(rank, played, total) {
  if (played === 0 || !(rank > 0)) return { k: 'unr', label: t('rk.t.unr'), div: 0, divTxt: '', idx: TIERS.length };
  const idx = Math.max(0, TIERS.findIndex(x => rank >= x.lo && rank <= x.hi));
  const T = TIERS[idx], div = divOf(T, rank, total);
  return { k: T.k, idx, div, divTxt: div ? DIVS[div - 1] : '', label: t('rk.t.' + T.k), ...tierSpan(T, total) };
}
const tierName = ti => ti.label + (ti.divTxt ? ' ' + ti.divTxt : '');
/* 往上一個小段、上一個段位各還差幾名（名次數字越小越好） */
function promoInfo(rank, total) {
  const ti = tier(rank, 1, total), out = { ti };
  if (ti.div > 1) {
    const T = TIERS[ti.idx], per = Math.ceil((ti.hi - ti.lo + 1) / 4);
    out.nextDiv = { n: rank - (T.lo + (ti.div - 1) * per - 1), name: ti.label + ' ' + DIVS[ti.div - 2] };
  }
  if (ti.idx > 0) {
    const up = TIERS[ti.idx - 1];
    out.nextTier = { n: rank - up.hi, name: t('rk.t.' + up.k) };
  }
  out.pct = ti.hi > ti.lo ? (ti.hi - rank) / (ti.hi - ti.lo) : 1;   // 在這個段位裡爬到哪
  return out;
}

/* 段位徽章（SVG）。每個徽章自己一組漸層 id，不然隱藏分頁裡的同名漸層會讓別的徽章畫不出來 */
let EMB = 0;
const GLYPH = {
  chal: '<path d="M30 60 L33 38 L42 48 L50 32 L58 48 L67 38 L70 60 Z" fill="#fff"/><rect x="30" y="62" width="40" height="6" rx="2" fill="#fff"/>',
  master: '<path d="M50 30 L55.9 43.9 L71 45.3 L59.6 55.2 L63 70 L50 62.3 L37 70 L40.4 55.2 L29 45.3 L44.1 43.9 Z" fill="#fff"/>',
  dia: '<path d="M38 36 H62 L72 48 L50 72 L28 48 Z" fill="#fff"/><path d="M28 48 H72 M41 36 L50 48 L59 36 M50 48 V72" stroke="rgba(0,0,0,.25)" stroke-width="2" fill="none"/>',
  plat: '<path d="M33 42 L50 32 L67 42 M33 54 L50 44 L67 54 M33 66 L50 56 L67 66" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  gold: '<path d="M33 48 L50 38 L67 48 M33 62 L50 52 L67 62" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  silver: '<path d="M33 56 L50 44 L67 56" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  bronze: '<rect x="35" y="47" width="30" height="7" rx="3.5" fill="#fff"/>',
  unr: '<text x="50" y="62" text-anchor="middle" font-size="32" font-weight="900" fill="#fff">?</text>',
};
function emblemSVG(k, size, anim) {
  const id = 'emb' + (++EMB);
  const hex = '50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5';
  const wings = (k === 'chal' || k === 'master')
    ? `<path d="M11 34 L0 26 L3 50 L0 74 L11 66 Z M89 34 L100 26 L97 50 L100 74 L89 66 Z" fill="url(#${id}g)" opacity=".85"/>` : '';
  return `<svg class="emb t-${k}${anim ? ' anim' : ''}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--t1)"/><stop offset=".55" style="stop-color:var(--t2)"/><stop offset="1" style="stop-color:var(--t3)"/></linearGradient>
      <clipPath id="${id}c"><polygon points="${hex}"/></clipPath></defs>
    ${wings}<polygon points="${hex}" fill="url(#${id}g)"/>
    <polygon points="50,17 78.5,33.5 78.5,66.5 50,83 21.5,66.5 21.5,33.5" fill="rgba(0,0,0,.22)"/>
    ${GLYPH[k] || ''}
    <g clip-path="url(#${id}c)"><rect class="shine" x="-60" y="-10" width="34" height="120" fill="rgba(255,255,255,.45)" transform="skewX(-20)"/></g>
    <polygon points="${hex}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.5"/></svg>`;
}
/* 列表用的小徽章：CSS 六角形，不必每列一個 SVG */
const embChip = ti => `<span class="temb t-${ti.k}" title="${esc(tierName(ti))}">${esc(ti.divTxt)}</span>`;

/* ---------- 圖表共用：一個浮動提示框（內容一律 textContent，隊名是外部資料） ---------- */
function chTip(x, y, val, label) {
  let el = document.getElementById('chTip');
  if (!el) { el = document.createElement('div'); el.id = 'chTip'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = '';
  const v = document.createElement('b'); v.textContent = val; el.appendChild(v);
  if (label) { const l = document.createElement('span'); l.textContent = label; el.appendChild(l); }
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
  el.style.top = Math.max(8, y - r.height - 12) + 'px';
}
function chTipHide() { const el = document.getElementById('chTip'); if (el) el.hidden = true; }
/* 手指一滑動頁面，提示就收掉，不然它會停在原地蓋住別的東西（capture：國家頁自己的捲動也算） */
document.addEventListener('scroll', chTipHide, { passive: true, capture: true });
/* 長條、欄位這種「標記本身就是目標」的提示：data-tv（數值）＋ data-tl（說明） */
function wireTips(root) {
  root.querySelectorAll('[data-tv]').forEach(el => {
    const show = () => { const r = el.getBoundingClientRect(); chTip(r.left + r.width / 2, r.top, el.dataset.tv, el.dataset.tl || ''); };
    el.addEventListener('pointerenter', show); el.addEventListener('focus', show);
    el.addEventListener('pointerleave', chTipHide); el.addEventListener('blur', chTipHide);
  });
}

/* 名次走勢：一條線（名次 1 在最上面），十字線跟著手指找最近的一點 */
function drawTrend(el) {
  const key = el.dataset.key, vals = (OFF.spark || {})[key] || [], times = OFF.sparkT || [];
  const pts = vals.map((v, i) => ({ v, t: times[i] || '' })).filter(p => p.v != null);
  const wrap = el.closest('.chwrap');
  if (pts.length < 2) { if (wrap) wrap.hidden = true; return; }
  const W = Math.max(240, el.clientWidth || 320), H = 166, L = 34, R = 14, T = 14, B = 26;
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (hi - lo < 4) { const pad = Math.ceil((4 - (hi - lo)) / 2); lo = Math.max(1, lo - pad); hi = lo + 4; }
  const X = i => L + (i / (pts.length - 1)) * (W - L - R);
  const Y = v => T + ((v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const area = path + ` L${X(pts.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z`;
  const last = pts[pts.length - 1], best = Math.min(...pts.map(p => p.v));
  const bi = pts.findIndex(p => p.v === best);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img"
      aria-label="${esc(t('rk.trend'))}: #${pts[0].v} → #${last.v}">
    ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">#${v}</text>`).join('')}
    <line class="base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
    ${pts[0].t ? `<text class="ax" x="${L}" y="${H - 8}">${esc(fmtMD(pts[0].t))}</text>` : ''}
    ${last.t ? `<text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmtMD(last.t))}</text>` : ''}
    <path class="area" d="${area}"/><path class="line" d="${path}"/>
    ${bi !== pts.length - 1 ? `<circle class="pk" cx="${X(bi)}" cy="${Y(best)}" r="4"/><text class="lbl" x="${X(bi)}" y="${Y(best) + (Y(best) < T + 14 ? 18 : -9)}" text-anchor="middle">${esc(t('rk.best'))} #${best}</text>` : ''}
    <circle class="end" cx="${X(pts.length - 1)}" cy="${Y(last.v)}" r="5"/>
    <text class="lbl" x="${X(pts.length - 1) - 9}" y="${Y(last.v) + (Y(last.v) < T + 14 ? 18 : -10)}" text-anchor="end">#${last.v}</text>
    <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="hd" r="5" visibility="hidden"/>
    <rect x="${L - 12}" y="0" width="${W - L - R + 24}" height="${H}" fill="transparent"/></svg>`;
  const svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), hd = svg.querySelector('.hd');
  let cur = pts.length - 1;
  const show = i => {
    cur = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[cur], x = X(cur), y = Y(p.v);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    hd.setAttribute('cx', x); hd.setAttribute('cy', y); hd.setAttribute('visibility', 'visible');
    const r = svg.getBoundingClientRect(), k = r.width / W;
    chTip(r.left + x * k, r.top + y * k, '#' + p.v, p.t ? fmtMD(p.t) : '');
  };
  const hide = () => { xh.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); chTipHide(); };
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width;
    show(Math.round((x - L) / ((W - L - R) / (pts.length - 1))));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(cur)); svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
  });
  /* 表格版：不用滑也看得到每一個數字 */
  const tb = wrap && wrap.querySelector('.chtable tbody');
  if (tb) tb.innerHTML = pts.map(p => `<tr><td>${esc(p.t ? fmtMD(p.t) : '')}</td><td>#${p.v}</td></tr>`).join('');
}
function trendBlock(key, title) {
  return `<div class="chwrap"><div class="lab2">${esc(title)}</div><div class="ch-trend" data-key="${esc(key)}"></div>
    <p class="note chnote">${esc(t('rk.trendH'))}</p>
    <details class="chtable"><summary>${esc(t('rk.table'))}</summary><table><thead><tr><th>${esc(t('rk.update'))}</th><th>${esc(t('rk.rankCol'))}</th></tr></thead><tbody></tbody></table></details></div>`;
}
/* 勝率環：單一比例 → 環形量表（底軌是同色系淡色） */
function winRing(w, l, tt) {
  const n = w + l + tt; if (!n) return '';
  const pct = w / n, R = 30, C = 2 * Math.PI * R;
  return `<div class="ring" role="img" aria-label="${esc(t('rk.winRate'))} ${Math.round(pct * 100)}%">
    <svg viewBox="0 0 76 76" width="76" height="76"><circle class="trk" cx="38" cy="38" r="${R}"/>
      <circle class="arc" cx="38" cy="38" r="${R}" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 38 38)"/></svg>
    <div class="rv"><b>${Math.round(pct * 100)}%</b><span>${esc(t('rk.winRate'))}</span></div></div>`;
}
function sparkSVG(vals) {
  vals = (vals || []).filter(v => v != null);              // 那次快照還沒有這一隊 → null
  if (vals.length < 2) return '';
  const w = 56, h = 18;
  /* 每一隊用自己的名次區間正規化，不然前段班的線會全部擠在頂端 */
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo = Math.max(1, lo - 1); hi = lo + 2; }
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = ((v - lo) / (hi - lo)) * (h - 4) + 2;        // 名次數字小 = 畫在上面
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const up = vals[0] > vals[vals.length - 1];              // 名次變小 = 進步
  return `<svg class="trend ${up ? 'up' : 'dn'}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function moveTag(d) {
  if (!d) return '';
  return d > 0 ? `<span class="mv up">▲${d}</span>` : `<span class="mv dn">▼${-d}</span>`;
}

/* ---------- 取得官方資料 ---------- */
async function ranksFetch(quiet) {
  if (AUTH.offline) { OFF.error = t('rk.needOnline'); renderRanks(); return; }
  try {
    const d = await api('/api/official');
    OFF.data = d.data || {};
    OFF.movement = d.movement || {};
    OFF.spark = d.spark || {};
    OFF.sparkT = d.sparkT || [];
    OFF.fetched = d.fetched || '';
    OFF.error = d.error || '';
    OFF.demo = false;
    buildKeyMap();
  } catch (e) { OFF.error = e.message; }
  renderRanks();
  /* 賽程表自己跟著更新，不用使用者按任何東西 */
  if (typeof autoSched === 'function') { try { autoSched(); } catch (e) {} }
  if (!quiet) haptic(8);
}
/* 賽前想先看介面長怎樣：造一份明顯標示 SAMPLE 的假資料 */
function ranksDemo() {
  const pick = NATIONS.filter(n => n.cc).slice(0, 48);
  const rankings = pick.map((n, i) => ({
    rank: i + 1, teamKey: n.cc.toUpperCase(),
    rankingScore: +(190 - i * 2.4 + (i % 5) * 3).toFixed(1),
    highestScore: Math.round(240 - i * 2.2 + (i % 7) * 6),
    played: 6, wins: Math.max(0, 6 - Math.floor(i / 8)), ties: i % 4 === 0 ? 1 : 0,
    losses: Math.min(6, Math.floor(i / 8)),
    team: { country: n.name, countryCode: n.cc.toUpperCase(), shortName: n.name, name: n.name },
  }));
  const matches = [];
  for (let i = 0; i < 14; i++) {
    const r = [0, 1, 2].map(k => pick[(i * 3 + k) % pick.length]);
    const b = [0, 1, 2].map(k => pick[(i * 3 + k + 9) % pick.length]);
    matches.push({
      id: 'demo' + i, name: 'Qualification ' + (i + 1), field: (i % 2) + 1,
      played: i < 9, tournamentKey: 'qual',
      scheduledTime: new Date(Date.now() + (i - 9) * 7 * 60000).toISOString(),
      participants: r.map((n, k) => ({ teamKey: n.cc.toUpperCase(), station: 11 + k, brace: i < 9 ? [0.3, 0.1, 0][(i + k) % 3] : undefined }))
        .concat(b.map((n, k) => ({ teamKey: n.cc.toUpperCase(), station: 21 + k, brace: i < 9 ? [0.2, 0.05, 0][(i + k) % 3] : undefined }))),
      redScore: 120 + ((i * 13) % 90), blueScore: 110 + ((i * 29) % 95),
      redClimbMultiplier: 1.4, blueClimbMultiplier: 1.25,
      redSuppressionUnitPoints: 74 + (i % 20), blueSuppressionUnitPoints: 68 + (i % 25),
      wildfireInExtinguisher: 30 + (i % 15), coopertition: [0, 10, 25, 40][i % 4],
    });
  }
  OFF.data = { rankings, matches, round_robin: [], finals: [], awards: [] };
  OFF.movement = Object.fromEntries(rankings.slice(0, 12).map((r, i) => [r.teamKey, [2, -1, 3, 0, -2, 1][i % 6]]));
  OFF.spark = Object.fromEntries(rankings.slice(0, 40).map(r =>
    [r.teamKey, Array.from({ length: 8 }, (_, i) => Math.max(1, r.rank + Math.round(Math.sin(i) * 4)))]));
  OFF.fetched = new Date().toISOString();
  OFF.demo = true; OFF.error = '';
  buildKeyMap();
  renderRanks();
}

/* ---------- 畫面 ---------- */
function ranksLoad() {
  if (!OFF.data && !OFF.error) ranksFetch(true);
  else renderRanks();
  clearInterval(OFF.timer);
  OFF.timer = setInterval(() => {                      // 只有停在這一頁而且是官方資料才自動刷新
    if ((!$('tab-teams').hidden || !$('tab-pit').hidden) && !document.hidden && !OFF.demo) ranksFetch(true);
  }, 60000);
}
function renderRanks() {
  const host = $('rkBody'); if (!host) return;
  $('rkStatus').innerHTML = OFF.demo
    ? `<span class="live demo">SAMPLE</span>`
    : OFF.error ? `<span class="live bad">${esc(t('rk.offline'))}</span>`
      : OFF.fetched ? `<span class="live ok"></span>${esc(t('rk.updated'))} ${esc(fmtTime(OFF.fetched))}`
        : `<span class="live wait"></span>${esc(t('rk.loading'))}`;
  if (rMode === 'ladder') host.innerHTML = ladderHTML();
  else if (rMode === 'matches') host.innerHTML = matchesHTML();
  else host.innerHTML = '';
  $('tList').hidden = rMode !== 'teams';
  $('tSortCard').hidden = rMode !== 'teams';
  $('rkFilters').hidden = rMode === 'teams';
  $('rkCont').hidden = rMode === 'teams';
  $('rkMatchFilter').hidden = rMode !== 'matches';
  if (rMode === 'teams') renderTeams();
  wireRanks();
}
function contOf(slug) { const n = NMAP[slug]; return n ? n.cont : ''; }
function filterRows(rows) {
  if (rCont === 'all') return rows;
  const mine = contOf(AUTH.team);
  return rows.filter(r => {
    const n = nationOf(r); if (!n) return false;
    return rCont === 'mine' ? n.cont === mine : n.cont === rCont;
  });
}
/* 官方資料是照隊伍編號排的，不是照名次。還沒有名次（0 或空）的排到最後 */
const rankOf = r => (Number.isFinite(r.rank) && r.rank > 0) ? r.rank : 1e9;
const byRank = (a, b) => rankOf(a) - rankOf(b) || (b.rankingScore || 0) - (a.rankingScore || 0);
const tfmt = (k, n, name) => t(k).replace('{n}', n).replace('{t}', name);
function ladderHTML() {
  const rows = ((OFF.data && OFF.data.rankings) || []).slice().sort(byRank);
  if (!rows.length) return emptyHTML();
  const total = rows.length;
  const mineRow = rows.find(r => rowSlug(r) === AUTH.team);
  const shown = filterRows(rows);
  let h = '';
  if (mineRow) h += youCardHTML(mineRow, total);
  const top = shown.filter(r => r.played > 0).slice(0, 3);
  if (top.length === 3) h += podiumHTML(top);
  if (shown.length) h += tierDistHTML(shown, total, mineRow);
  return h + ladderListHTML(shown, total);
}
/* 你們的段位卡：徽章、小段、晉級進度、勝率環、名次走勢 */
function youCardHTML(r, total) {
  const L = rowLabel(r), ti = tier(r.rank, r.played, total);
  const w = r.wins || 0, l = r.losses || 0, tt = r.ties || 0;
  const climbAvg = r.played ? (r.climbPoints || 0) / r.played : null;
  let promo;
  if (ti.k === 'unr') promo = `<p class="note promo">${esc(t('rk.placement'))}</p>`;
  else {
    const pr = promoInfo(r.rank, total), lines = [];
    if (pr.nextDiv) lines.push(tfmt('rk.promoTo', pr.nextDiv.n, pr.nextDiv.name));
    if (pr.nextTier) lines.push(tfmt('rk.promoTo', pr.nextTier.n, pr.nextTier.name));
    if (!pr.nextTier) lines.push(r.rank === 1 ? t('rk.atTop') : tfmt('rk.toFirst', r.rank - 1, ''));
    /* 升鑽石就等於進季後賽線，同一件事不用講兩次 */
    if (r.rank > PLAYOFF_CUT && !(pr.nextTier && pr.nextTier.n === r.rank - PLAYOFF_CUT)) lines.push(`${t('rk.toPlayoff')} ${r.rank - PLAYOFF_CUT}`);
    const pct = Math.round(pr.pct * 100);
    promo = `<div class="promo"><div class="pbar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
        aria-label="${esc(tierName(ti))}"><i style="width:${Math.max(4, pct)}%"></i></div>
      <div class="plines">${lines.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`;
  }
  return `<div class="card you t-${ti.k}">
    <div class="youhero">
      <div class="embwrap">${emblemSVG(ti.k, 104, true)}${ti.divTxt ? `<span class="divb">${esc(ti.divTxt)}</span>` : ''}</div>
      <div class="youinfo"><span class="lb">${esc(t('rk.tierYou'))}</span>
        <div class="tname">${esc(tierName(ti))}</div>
        <div class="youteam"><span class="fl">${L.flag}</span><b>${esc(L.name)}</b></div>
        <div class="yourank">#${r.rank}<small>/ ${total}</small>${moveTag(OFF.movement[r.teamKey])}</div></div>
    </div>
    ${promo}
    <div class="youstats">${winRing(w, l, tt)}
      <div class="row stats">
        <div><div class="note">${esc(t('rk.rs'))}</div><div class="stat">${r.rankingScore ?? '—'}</div></div>
        <div><div class="note">${esc(t('rk.record'))}</div><div class="stat sm">${w}-${l}-${tt}</div></div>
        <div><div class="note">${esc(t('rk.high'))}</div><div class="stat sm">${r.highestScore ?? '—'}</div></div>
        ${climbAvg != null ? `<div><div class="note">${esc(t('rk.avgClimb'))}</div><div class="stat sm">+${climbAvg.toFixed(2)}</div></div>` : ''}
      </div></div>
    ${trendBlock(r.teamKey, t('rk.trend'))}
  </div>`;
}
/* 頒獎台：前三名（篩洲的時候就是那一洲的前三）。高度照第幾名，柱子上寫的是總名次 */
function podiumHTML(top) {
  const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
  return `<div class="card podcard"><h2><span class="ic">🏆</span>${esc(t(rCont === 'all' ? 'rk.podium3' : 'rk.podium3c'))}</h2>
    <div class="podium">${order.map(([r, place]) => {
      const L = rowLabel(r);
      return `<button class="pod p${place}" data-team="${esc(rowSlug(r))}">
        ${place === 1 ? '<span class="crown" aria-hidden="true">👑</span>' : ''}
        <span class="pfl">${L.flag}</span><b class="pnm">${esc(L.name)}</b><span class="psc">${r.rankingScore ?? '—'}</span>
        <span class="pillar"><span class="pnum">#${r.rank}</span></span></button>`;
    }).join('')}</div></div>`;
}
/* 段位分布：一個數列（每個段位幾隊）→ 強調式長條，你們的段位上色、其餘灰色；點一條跳到那一段 */
function tierDistHTML(shown, total, mineRow) {
  const counts = TIERS.map(() => 0); let unr = 0;
  shown.forEach(r => { const ti = tier(r.rank, r.played, total); if (ti.k === 'unr') unr++; else counts[ti.idx]++; });
  const myK = mineRow ? tier(mineRow.rank, mineRow.played, total).k : '';
  const rows = TIERS.map((T, i) => { const sp = tierSpan(T, total); return { k: T.k, n: counts[i], rng: sp.lo > total ? '' : `#${sp.lo}–${Math.min(sp.hi, total)}` }; })
    .filter(x => x.rng);
  if (unr) rows.push({ k: 'unr', n: unr, rng: '' });
  const max = Math.max(1, ...rows.map(x => x.n));
  const nm = k => t('rk.t.' + k);
  return `<div class="card"><h2><span class="ic">📊</span>${esc(t('rk.dist'))}</h2>
    <p class="note" style="margin:-6px 0 12px">${esc(t('rk.distH'))}</p>
    <div class="dist">${rows.map(x => `<button class="dbar${x.k === myK ? ' me' : ''}" data-jump="${x.k}"
        data-tv="${x.n} ${esc(t('rk.teams'))}" data-tl="${esc(nm(x.k) + (x.rng ? ' · ' + x.rng : ''))}"
        aria-label="${esc(nm(x.k))} ${x.n} ${esc(t('rk.teams'))}">
        <span class="dl"><span class="temb t-${x.k}"></span><span class="dn">${esc(nm(x.k))}</span>${x.k === myK ? `<span class="tag ok">${esc(t('rk.you'))}</span>` : ''}</span>
        <span class="dt"><i style="width:${(100 * x.n / max).toFixed(1)}%"></i><em>${x.n}</em></span></button>`).join('')}</div>
    <details class="chtable"><summary>${esc(t('rk.table'))}</summary><table><thead><tr><th>${esc(t('rk.tierCol'))}</th><th>${esc(t('rk.rankCol'))}</th><th>${esc(t('rk.teams'))}</th></tr></thead>
      <tbody>${rows.map(x => `<tr><td>${esc(nm(x.k))}</td><td>${esc(x.rng)}</td><td>${x.n}</td></tr>`).join('')}</tbody></table></details></div>`;
}
/* 排行榜本體：照段位分組，24 名和 25 名之間畫季後賽晉級線 */
function ladderListHTML(shown, total) {
  if (!shown.length) return `<div class="list ladder"><div class="empty">${esc(t('rk.noneHere'))}</div></div>`;
  let h = '<div class="list ladder">', curK = null, cut = false;
  shown.forEach(r => {
    const L = rowLabel(r), ti = tier(r.rank, r.played, total), me = rowSlug(r) === AUTH.team;
    if (!cut && curK !== null && r.rank > PLAYOFF_CUT && ti.k !== 'unr') {
      cut = true; h += `<div class="cutline"><span>${esc(t('rk.cut'))}</span></div>`;
    }
    if (ti.k !== curK) {
      curK = ti.k;
      h += `<div class="tierhd t-${ti.k}" id="tier-${ti.k}"><span class="temb t-${ti.k}"></span><b>${esc(ti.label)}</b>
        ${ti.k !== 'unr' ? `<span class="rng">#${ti.lo}–${Math.min(ti.hi, total)}</span>` : ''}</div>`;
    }
    h += `<div class="it lad t-${ti.k}${me ? ' me' : ''}" data-team="${esc(rowSlug(r))}">
      <div class="rk">${r.rank}</div>${embChip(ti)}
      <div class="fl">${L.flag}</div>
      <div class="d"><div class="lname"><b>${esc(L.name)}</b>${me ? `<span class="tag ok">${esc(t('rk.you'))}</span>` : ''}${moveTag(OFF.movement[r.teamKey])}</div>
        <div class="lstats"><b>${r.rankingScore ?? '—'}</b><span>${esc(tierName(ti))}</span><span>${esc(t('rk.high'))} ${r.highestScore ?? '—'}</span><span>${r.played ?? 0} ${esc(t('n.matches'))}</span></div></div>
      ${sparkSVG(OFF.spark[r.teamKey])}
      </div>`;
  });
  return h + '</div>';
}
function matchesHTML() {
  const all = (OFF.data && OFF.data.matches) || [];
  if (!all.length) return emptyHTML();
  const myKeys = new Set();
  ((OFF.data && OFF.data.rankings) || []).forEach(r => { if (rowSlug(r) === AUTH.team) myKeys.add(r.teamKey); });
  let rows = all.slice();
  if (rMatchFilter === 'mine') rows = rows.filter(m => (m.participants || []).some(p => myKeys.has(p.teamKey)));
  else if (rMatchFilter === 'played') rows = rows.filter(m => m.played);
  else if (rMatchFilter === 'next') rows = rows.filter(m => !m.played);
  /* 「即將到來」要看最近的前 60 場；其他模式看最後 60 場、最新在上 */
  rows = rMatchFilter === 'next' ? rows.slice(0, 60) : rows.slice(-60).reverse();
  if (!rows.length) return `<div class="list"><div class="empty">${esc(t('rk.noneHere'))}</div></div>`;
  const side = (m, s) => (m.participants || []).filter(p => allianceOf(p.station) === s)
    .map(p => { const sl = slugOfKey(p.teamKey); return sl ? nFlag(sl) : '🏳️'; }).join(' ');
  return '<div class="list">' + rows.map(m => {
    const rs = m.redScore ?? m.red_score, bs = m.blueScore ?? m.blue_score;
    const redWin = m.played && rs > bs, blueWin = m.played && bs > rs;
    const mine = (m.participants || []).some(p => myKeys.has(p.teamKey));
    return `<div class="it mt${mine ? ' me' : ''}" data-mid="${esc(matchKey(m))}">
      <div class="d">
        <div class="mhead"><b>${esc(m.name || ('Match ' + (m.id || '')))}</b>
          ${m.field ? `<span class="tag">F${m.field}</span>` : ''}
          ${m.played ? '' : `<span class="tag ok">${esc(m.scheduledTime ? fmtTime(m.scheduledTime) : t('rk.upcoming'))}</span>`}</div>
        <div class="vs">
          <span class="al R ${redWin ? 'win' : ''}">${side(m, 'R')}<b>${m.played ? (rs ?? '—') : ''}</b></span>
          <span class="vsx">vs</span>
          <span class="al B ${blueWin ? 'win' : ''}"><b>${m.played ? (bs ?? '—') : ''}</b>${side(m, 'B')}</span>
        </div>
      </div></div>`;
  }).join('') + '</div>';
}
function emptyHTML() {
  return `<div class="card"><div class="empty" style="padding:30px 14px">
    <div style="font-size:34px;margin-bottom:8px">🏁</div>
    <b>${esc(t('rk.notYet'))}</b><br>
    <span class="note">${esc(t('rk.notYetH'))}</span>
    <div class="bar" style="justify-content:center;margin-top:14px">
      <button class="btn" id="rkDemo">${esc(t('rk.preview'))}</button>
      <button class="btn" id="rkRefresh">${esc(t('rk.refresh'))}</button>
    </div></div></div>`;
}
function wireRanks() {
  const d = $('rkDemo'); if (d) d.onclick = ranksDemo;
  const rf = $('rkRefresh'); if (rf) rf.onclick = () => ranksFetch();
  const host = $('rkBody');
  host.querySelectorAll('.it.lad, .pod').forEach(el => el.onclick = () => {
    if (el.dataset.team) openNation(el.dataset.team);
  });
  host.querySelectorAll('.it.mt').forEach(el => el.onclick = () => matchSheet(el.dataset.mid));
  /* 點段位分布的一條 → 捲到排行榜裡那個段位 */
  host.querySelectorAll('.dbar').forEach(el => el.onclick = () => {
    const x = document.getElementById('tier-' + el.dataset.jump);
    if (x) x.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
  });
  host.querySelectorAll('.ch-trend').forEach(drawTrend);     // 要量得到寬度，所以畫面放上去之後才畫
  wireTips(host);
}
/* 單場比賽的官方計分細節 */
const BRACE = { 0: 'None', 0.05: 'Contact', 0.1: 'Zone 1', 0.2: 'Zone 2', 0.3: 'Zone 3' };
function matchSheet(id) {
  const m = ((OFF.data && OFF.data.matches) || []).find(x => matchKey(x) === String(id));
  if (!m) return;
  const line = (k, v) => v === undefined || v === null || v === '' ? '' : `<b>${esc(k)}</b><span>${esc(String(v))}</span>`;
  const rs = m.redScore, bs = m.blueScore;
  const kv = [
    line(t('n.offScore'), m.played ? `${rs ?? '—'} : ${bs ?? '—'}` : undefined),
    line(t('rk.suppression'), m.redSuppressionUnitPoints !== undefined
      ? `${m.redSuppressionUnitPoints} / ${m.blueSuppressionUnitPoints}` : undefined),
    line(t('rk.climbMult'), m.redClimbMultiplier != null
      ? `${multTxt(m.redClimbMultiplier)} / ${multTxt(m.blueClimbMultiplier)}` : undefined),
    line(t('c.ext'), m.wildfireInExtinguisher),
    line(t('rk.coop'), m.coopertition),
    line(t('rk.field'), m.field),
    line(t('rk.time'), m.scheduledTime ? fmtDT(m.scheduledTime) : ''),
  ].filter(Boolean).join('');
  const robots = (m.participants || []).slice()
    .sort((a, b) => String(a.station).localeCompare(String(b.station)))
    .map(p => {
      const sl = slugOfKey(p.teamKey), al = allianceOf(p.station);
      return `<div class="it orb" data-team="${esc(sl)}"><div class="n ${al}">${al || '?'}</div><div class="fl">${sl ? nFlag(sl) : '🏳️'}</div>
        <div class="d"><b>${esc(sl ? nName(sl) : String(p.teamKey))}</b><br>${braceTag(p.brace)}${p.partnerClimb ? `<span class="tag ok">${esc(t('n.offPartner'))}</span>` : ''}${p.noShow ? `<span class="tag bad">${esc(t('n.offNoShow'))}</span>` : ''}</div></div>`;
    }).join('');
  const { sh, close } = openSheet(`<div class="hd"><b style="font-size:17px">${esc(m.name || 'Match')}</b>
      <button class="btn" data-close style="margin-left:auto;min-height:44px;padding:8px 14px">${esc(t('menu.close'))}</button></div>
    <div class="menu"><div class="kv">${kv || `<span class="note">${esc(t('rk.noDetail'))}</span>`}</div>
      ${robots ? `<div class="lab2">${esc(t('n.offRobots'))}</div><div class="list">${robots}</div>` : ''}
      <p class="note" style="margin-top:12px">${esc(t('rk.fromOfficial'))}</p></div>`);
  /* 點一台機器人 → 打開那一國的頁面，看它的歷史戰績 */
  sh.querySelectorAll('.orb').forEach(el => el.onclick = () => {
    if (!el.dataset.team) return;
    close(); openNation(el.dataset.team);
  });
}

/* ---------- 一國的官方戰績：每一場的比分、自己的爬升、整個聯盟的爬升倍率 ---------- */
function teamMatches(slug) {
  const keys = new Set(Object.keys(KEY2SLUG).filter(k => KEY2SLUG[k] === slug));
  if (!keys.size) return [];
  const out = [];
  ((OFF.data && OFF.data.matches) || []).forEach(m => {
    const ps = m.participants || [];
    const me = ps.find(p => keys.has(String(p.teamKey).toUpperCase()));
    if (!me) return;
    const al = allianceOf(me.station);
    const us = al === 'R' ? m.redScore : m.blueScore, them = al === 'R' ? m.blueScore : m.redScore;
    out.push({
      m, al, us, them,
      mates: ps.filter(p => p !== me && allianceOf(p.station) === al).map(p => slugOfKey(p.teamKey)),
      opps: ps.filter(p => allianceOf(p.station) && allianceOf(p.station) !== al).map(p => slugOfKey(p.teamKey)),
      res: !m.played ? '' : us > them ? 'W' : us < them ? 'L' : 'T',
      brace: me.brace, pc: !!me.partnerClimb, noShow: !!me.noShow,
      mult: al === 'R' ? m.redClimbMultiplier : m.blueClimbMultiplier,
    });
  });
  const when = x => tsOf(x.m.scheduledTime) || 0;
  return out.sort((a, b) => when(a) - when(b) || (+a.m.id || 0) - (+b.m.id || 0));
}
function officialHistoryHTML(slug) {
  const rows = teamMatches(slug);
  if (!rows.length) return '';
  const played = rows.filter(r => r.m.played), next = rows.filter(r => !r.m.played);
  const climbs = played.filter(r => r.brace != null);
  const avg = (arr, f) => arr.length ? arr.reduce((s, r) => s + (+f(r) || 0), 0) / arr.length : null;
  const cnt = k => played.filter(r => r.res === k).length;
  const avgScore = avg(played, r => r.us), avgClimb = avg(climbs, r => r.brace);
  const mults = played.filter(r => r.mult), avgMult = avg(mults, r => r.mult);
  const best = climbs.reduce((b, r) => Math.max(b, +r.brace || 0), 0);
  const flags = list => list.map(sl => sl ? nFlag(sl) : '🏳️').join(' ');
  const stat = (k, v, small) => `<div><div class="note">${esc(k)}</div><div class="stat"${small ? ' style="font-size:20px"' : ''}>${v}</div></div>`;
  let h = `<div class="card" id="nOff"><h2><span class="ic">📜</span>${esc(t('n.offRec'))}</h2>`;
  const rk = (OFF.data && OFF.data.rankings) || [], rr = rk.find(r => rowSlug(r) === slug);
  if (rr) {
    const ti = tier(rr.rank, rr.played, rk.length);
    h += `<div class="ohero t-${ti.k}">${emblemSVG(ti.k, 72)}
      <div class="ohi"><b>${esc(tierName(ti))}</b><span>#${rr.rank} / ${rk.length} · ${esc(t('rk.rs'))} ${rr.rankingScore ?? '—'}</span></div>
      ${winRing(rr.wins || 0, rr.losses || 0, rr.ties || 0)}</div>`;
  }
  if (played.length) {
    h += `<div class="row stats">
      ${stat(t('n.matches'), played.length)}
      ${stat(t('rk.record'), `${cnt('W')}-${cnt('L')}-${cnt('T')}`, true)}
      ${stat(t('n.offAvgScore'), avgScore == null ? '—' : avgScore.toFixed(0))}
      ${climbs.length ? stat(t('n.offAvgClimb'), '+' + avgClimb.toFixed(2), true) : ''}
      ${climbs.length ? stat(t('n.offClimbed'), `${climbs.filter(r => r.brace > 0).length}/${climbs.length}`, true) : ''}
      ${climbs.length ? stat(t('n.best'), esc(CLIMB_LABEL[braceCode(best)] || '—'), true) : ''}
      ${mults.length ? stat(t('n.offAvgMult'), '×' + avgMult.toFixed(2), true) : ''}
    </div>`;
    if (played.length >= 2) {
      /* 每一場的聯盟得分：一個數列 → 單色直條，只標最高那場，其他看提示或下面的列表 */
      const maxS = Math.max(1, ...played.map(r => +r.us || 0));
      h += `<div class="lab2">${esc(t('n.scoreChart'))}</div><div class="cols">${played.map(r => {
        const v = +r.us || 0, c = braceCode(r.brace);
        const tl = [r.m.name, t('n.off' + r.res)].concat(r.brace != null ? [c === '0' ? t('n.offNoClimb') : CLIMB_LABEL[c]] : []).join(' · ');
        return `<button class="col" data-mid="${esc(matchKey(r.m))}" data-tv="${r.us ?? '—'} : ${r.them ?? '—'}" data-tl="${esc(tl)}" aria-label="${esc(tl)}: ${v}">
          <span class="cplot"><span class="cbar" style="height:${(100 * v / maxS).toFixed(1)}%">${v === maxS ? `<em>${v}</em>` : ''}</span></span>
          <span class="cx">${esc(matchShort(r.m.name))}</span></button>`;
      }).join('')}</div>`;
    }
    if (climbs.length) {
      /* 一場一格，顏色就是那一場爬到哪：一眼看出穩不穩 */
      h += `<div class="lab2">${esc(t('n.offStrip'))}</div><div class="cstrip">${climbs.map(r => {
        const c = braceCode(r.brace);
        return `<span class="cs ${c === '0' ? 'none' : CLIMB_TAG[c]}" title="${esc(r.m.name || '')}"><b>${esc(matchShort(r.m.name))}</b>${esc(c === '0' ? '—' : c === 'C' ? 'C' : 'Z' + c)}</span>`;
      }).join('')}</div>`;
    }
  } else {
    h += `<p class="note">${esc(t('n.offNoneYet'))}</p>`;
  }
  if (rr) h += trendBlock(rr.teamKey, t('rk.trend'));
  const row = r => `<div class="it oh" data-mid="${esc(matchKey(r.m))}">
      <div class="n ${r.al}">${esc(matchShort(r.m.name))}</div>
      <div class="d">${r.m.played
        ? `<div class="ohtop"><span class="res ${r.res}">${esc(t('n.off' + r.res))}</span><b>${r.us ?? '—'} : ${r.them ?? '—'}</b>${braceTag(r.brace)}${r.mult ? `<span class="tag">${esc(t('n.offAll'))} ${multTxt(r.mult)}</span>` : ''}${r.pc ? `<span class="tag ok">${esc(t('n.offPartner'))}</span>` : ''}${r.noShow ? `<span class="tag bad">${esc(t('n.offNoShow'))}</span>` : ''}</div>`
        : `<div class="ohtop"><b>${esc(r.m.scheduledTime ? fmtMD(r.m.scheduledTime) : t('rk.upcoming'))}</b>${r.m.field ? `<span class="tag">F${r.m.field}</span>` : ''}</div>`}
        <div class="note ohwho">${esc(t('n.offWith'))} ${flags(r.mates)} · vs ${flags(r.opps)}</div></div></div>`;
  if (played.length) h += `<div class="lab2">${esc(t('n.offPlayed'))}</div><div class="list">${played.slice().reverse().map(row).join('')}</div>`;
  if (next.length) h += `<div class="lab2">${esc(t('n.offNext'))}</div><div class="list">${next.map(row).join('')}</div>`;
  h += `<p class="note" style="margin-top:10px">${esc(t('n.offNote'))}</p></div>`;
  return h;
}
function wireOfficialHistory(root) {
  const box = root.querySelector('#nOff'); if (!box) return;
  box.querySelectorAll('.it.oh, .col').forEach(el => el.onclick = () => matchSheet(el.dataset.mid));
  box.querySelectorAll('.ch-trend').forEach(drawTrend);      // 國家頁要先顯示出來才量得到寬度
  wireTips(box);
}
/* 轉手機方向、拉視窗之後重畫，圖表寬度才會跟著變 */
window.addEventListener('resize', (() => { let tm; return () => { clearTimeout(tm); tm = setTimeout(() => {
  if (!$('tab-teams').hidden && rMode === 'ladder') renderRanks();
  document.querySelectorAll('#nation:not([hidden]) .ch-trend').forEach(drawTrend);
}, 300); }; })());

/* ---------- 控制列 ---------- */
function initRanks() {
  segInit($('rkMode'), 'ladder', v => { rMode = v || 'ladder'; renderRanks(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  const cont = $('rkCont');
  cont.innerHTML = [['all', t('rk.all')], ['mine', t('rk.myCont')]]
    .concat(Object.keys(CONT_NAMES).filter(k => k !== 'xx').map(k => [k, CONT_NAMES[k]]))
    .map(([k, label]) => `<button data-v="${k}">${esc(label)}</button>`).join('');
  segInit(cont, 'all', v => { rCont = v || 'all'; renderRanks(); });
  segInit($('rkMatchFilter'), 'all', v => { rMatchFilter = v || 'all'; renderRanks(); });
  $('rkStatus').onclick = () => ranksFetch();
}
