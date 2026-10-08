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
function ladderHTML() {
  const rows = ((OFF.data && OFF.data.rankings) || []).slice().sort(byRank);
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
  document.querySelectorAll('#rkBody .it.lad').forEach(el => el.onclick = () => {
    if (el.dataset.team) openNation(el.dataset.team);
  });
  document.querySelectorAll('#rkBody .it.mt').forEach(el => el.onclick = () => matchSheet(el.dataset.mid));
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
  root.querySelectorAll('#nOff .it.oh').forEach(el => el.onclick = () => matchSheet(el.dataset.mid));
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
