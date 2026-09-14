'use strict';
/* FGC 2026 Scouting — live ladder / match history / analytics, fed by results.first.global */

const OFF = { data: null, movement: {}, spark: {}, fetched: '', error: '', demo: false, timer: 0 };
let rMode = 'ladder';        // ladder | matches | teams
let rCont = 'all';           // all | af | am | as | eu | oc | mine
let rMatchFilter = 'all';    // all | mine | played | next

/* ---------- helpers ---------- */
const CONT_NAMES = window.CONTINENTS || {};
/* 官方用 3 碼國碼 (TPE/JPN)，我們用 slug；靠國名與 ISO-2 兜起來 */
const BY_NAME = {}, BY_CC = {};
NATIONS.forEach(n => {
  BY_NAME[(n.name || '').toLowerCase()] = n;
  if (n.cc) BY_CC[n.cc.toLowerCase()] = n;
});
function nationOf(row) {
  const t = (row && row.team) || {};
  const cc2 = (t.countryCode || '').toLowerCase();
  if (cc2.length === 2 && BY_CC[cc2]) return BY_CC[cc2];
  const nm = (t.country || t.shortName || t.name || '').toLowerCase();
  if (BY_NAME[nm]) return BY_NAME[nm];
  for (const n of NATIONS) {                       // 最後手段：寬鬆比對
    const a = (n.name || '').toLowerCase();
    if (nm && (a.includes(nm) || nm.includes(a))) return n;
  }
  return null;
}
function rowSlug(row) { const n = nationOf(row); return n ? n.slug : ''; }

/* teamKey 是三碼（TWN、MLT…），直接砍前兩碼會出事：MLT 是馬爾他，ML 是馬利。
   排名資料裡每一列同時有 teamKey 和國家，所以對照表直接從資料本身建。 */
const KEY2SLUG = {};
function buildKeyMap() {
  ((OFF.data && OFF.data.rankings) || []).forEach(r => {
    const n = nationOf(r);
    if (n && r.teamKey) KEY2SLUG[String(r.teamKey).toUpperCase()] = n.slug;
  });
}
function slugOfKey(k) {
  k = String(k || '').toUpperCase();
  if (KEY2SLUG[k]) return KEY2SLUG[k];
  const n = BY_CC[k.slice(0, 2).toLowerCase()];   // 還沒有排名資料時的退路
  return n ? n.slug : '';
}
function rowLabel(row) {
  const n = nationOf(row), t = (row && row.team) || {};
  const name = n ? nName(n.slug) : (t.country || t.shortName || t.name || row.teamKey || '—');
  return { flag: n ? nFlag(n.slug) : '🏳️', name, sub: n ? nSub(n.slug) : '', cont: n ? n.cont : '' };
}
/* 遊戲式段位：前 24 名可以進季後賽，那條線最有意義 */
function tier(rank) {
  if (rank === 1) return { k: 'champ', label: t('rk.champion'), icon: '👑' };
  if (rank <= 3) return { k: 'podium', label: t('rk.podium'), icon: '🏅' };
  if (rank <= 24) return { k: 'playoff', label: t('rk.playoff'), icon: '🔥' };
  if (rank <= 60) return { k: 'contend', label: t('rk.contender'), icon: '⚔️' };
  return { k: 'rising', label: t('rk.rising'), icon: '🌱' };
}
function sparkSVG(vals) {
  if (!vals || vals.length < 2) return '';
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
      participants: r.map(n => ({ teamKey: n.cc.toUpperCase(), station: 'RED' }))
        .concat(b.map(n => ({ teamKey: n.cc.toUpperCase(), station: 'BLUE' }))),
      redScore: 120 + ((i * 13) % 90), blueScore: 110 + ((i * 29) % 95),
      redClimbMultiplier: 0.4, blueClimbMultiplier: 0.3,
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
function ladderHTML() {
  const rows = (OFF.data && OFF.data.rankings) || [];
  if (!rows.length) return emptyHTML();
  const mineRow = rows.find(r => rowSlug(r) === AUTH.team);
  const shown = filterRows(rows);
  let h = '';
  if (mineRow) {
    const L = rowLabel(mineRow), ti = tier(mineRow.rank);
    h += `<div class="card you ${ti.k}">
      <div class="youtop"><span class="fl">${L.flag}</span>
        <div><span class="lb">${esc(t('rk.yourRank'))}</span><b>${esc(L.name)}</b></div>
        <div class="bigrank">#${mineRow.rank}${moveTag(OFF.movement[mineRow.teamKey])}</div></div>
      <div class="tierbar ${ti.k}"><span>${ti.icon} ${esc(ti.label)}</span>
        ${mineRow.rank <= 24 ? '' : `<span class="togo">${esc(t('rk.toPlayoff'))} ${mineRow.rank - 24}</span>`}</div>
      <div class="row stats">
        <div><div class="note">${esc(t('rk.rs'))}</div><div class="stat">${mineRow.rankingScore ?? '—'}</div></div>
        <div><div class="note">${esc(t('rk.high'))}</div><div class="stat">${mineRow.highestScore ?? '—'}</div></div>
        <div><div class="note">${esc(t('rk.played'))}</div><div class="stat">${mineRow.played ?? 0}</div></div>
        ${mineRow.wins == null ? '' : `<div><div class="note">${esc(t('rk.record'))}</div><div class="stat" style="font-size:20px">${mineRow.wins}-${mineRow.losses ?? 0}-${mineRow.ties ?? 0}</div></div>`}
      </div>
      ${sparkSVG(OFF.spark[mineRow.teamKey])}
    </div>`;
  }
  h += '<div class="list ladder">';
  h += shown.length ? shown.map(r => {
    const L = rowLabel(r), ti = tier(r.rank), me = rowSlug(r) === AUTH.team;
    return `<div class="it lad ${ti.k}${me ? ' me' : ''}" data-team="${esc(rowSlug(r))}">
      <div class="rk">${r.rank}</div>
      <div class="fl">${L.flag}</div>
      <div class="d"><div class="lname"><b>${esc(L.name)}</b>${me ? `<span class="tag ok">${esc(t('rk.you'))}</span>` : ''}${moveTag(OFF.movement[r.teamKey])}</div>
        <div class="lstats"><b>${r.rankingScore ?? '—'}</b><span>${esc(t('rk.high'))} ${r.highestScore ?? '—'}</span><span>${r.played ?? 0} ${esc(t('n.matches'))}</span></div></div>
      ${sparkSVG(OFF.spark[r.teamKey])}
      </div>`;
  }).join('') : `<div class="empty">${esc(t('rk.noneHere'))}</div>`;
  h += '</div>';
  return h;
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
  const side = (m, s) => (m.participants || []).filter(p => (p.station || '').toUpperCase().startsWith(s))
    .map(p => { const sl = slugOfKey(p.teamKey); return sl ? nFlag(sl) : '🏳️'; }).join(' ');
  return '<div class="list">' + rows.map(m => {
    const rs = m.redScore ?? m.red_score, bs = m.blueScore ?? m.blue_score;
    const redWin = m.played && rs > bs, blueWin = m.played && bs > rs;
    const mine = (m.participants || []).some(p => myKeys.has(p.teamKey));
    return `<div class="it mt${mine ? ' me' : ''}" data-mid="${esc(m.id || '')}">
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
  document.querySelectorAll('#rkBody .it.lad').forEach(el => el.onclick = () => {
    if (el.dataset.team) openNation(el.dataset.team);
  });
  document.querySelectorAll('#rkBody .it.mt').forEach(el => el.onclick = () => matchSheet(el.dataset.mid));
}
/* 單場比賽的官方計分細節 */
const BRACE = { 0: 'None', 0.05: 'Contact', 0.1: 'Zone 1', 0.2: 'Zone 2', 0.3: 'Zone 3' };
function matchSheet(id) {
  const m = ((OFF.data && OFF.data.matches) || []).find(x => String(x.id) === String(id));
  if (!m) return;
  const line = (k, v) => v === undefined || v === null || v === '' ? '' : `<b>${esc(k)}</b><span>${esc(String(v))}</span>`;
  const kv = [
    line(t('rk.suppression'), m.redSuppressionUnitPoints !== undefined
      ? `${m.redSuppressionUnitPoints} / ${m.blueSuppressionUnitPoints}` : undefined),
    line(t('rk.climbMult'), m.redClimbMultiplier !== undefined
      ? `×${(1 + (m.redClimbMultiplier || 0)).toFixed(2)} / ×${(1 + (m.blueClimbMultiplier || 0)).toFixed(2)}` : undefined),
    line(t('c.ext'), m.wildfireInExtinguisher),
    line(t('rk.coop'), m.coopertition),
    line(t('rk.field'), m.field),
    line(t('rk.time'), m.scheduledTime ? fmtDT(m.scheduledTime) : ''),
  ].filter(Boolean).join('');
  openSheet(`<div class="hd"><b style="font-size:17px">${esc(m.name || 'Match')}</b>
      <button class="btn" data-close style="margin-left:auto;min-height:44px;padding:8px 14px">${esc(t('menu.close'))}</button></div>
    <div class="menu"><div class="kv">${kv || `<span class="note">${esc(t('rk.noDetail'))}</span>`}</div>
      <p class="note" style="margin-top:12px">${esc(t('rk.fromOfficial'))}</p></div>`);
}

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
