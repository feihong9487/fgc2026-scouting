// FGC 2026 Scouting — translations part 9: pit visits (record any team, not only this match's allies)
// sign-in without claim codes (every nation starts with the password "password"), and the official
// match record on each nation page (score, own climb and alliance climb multiplier per match).
// Strings that used to mention claim codes are dropped from the other languages so they fall back
// to English instead of telling teams to ask for a code that no longer exists.
(function(){
const I = window.I18N, ADD = {
en:{"sc.modeAlly":"My allies","sc.modeVisit":"Visit any team",
 "sc.allyH":"Before a match: pick this match's two allies and go ask them.",
 "sc.visitH":"Walk the pits and record any team, whether or not you play with them.",
 "sc.visitT":"Pit visit","sc.visitPick":"Which team are you talking to?","sc.todo":"At the event, not visited yet",
 "ab.scout":"Two ways to fill this in: before a match, pick your two allies and go ask them; or walk the pits and record any team you visit. Answers are kept per nation, so one visit is enough.",
 "auth.defaultNote":"Each nation has its own account and its own data. The password is \"password\" until your team changes it.",
 "menu.guestNote":"Guest mode — nothing is saved to the server. Sign in as your team to sync and publish.",
 "r.guestCant":"Guest mode cannot publish or upload — sign in as your team",
 "r.guestBanner":"You are a guest: this page stays on your phone and is never published. Sign in as your team to share your robot."},

"zh-Hant":{"sc.modeAlly":"這場盟友","sc.modeVisit":"自由訪問",
 "sc.allyH":"開打之前：選這一場的兩個盟友，下去問他們。",
 "sc.visitH":"在維修區隨便走，哪一國都能記，不一定要跟你們同隊。",
 "sc.visitT":"維修區訪問","sc.visitPick":"你現在在問哪一國？","sc.todo":"這次有來、還沒問過的",
 "ab.scout":"兩種用法：開打前選這場的兩個盟友下去問；或是在維修區隨便逛，遇到哪一國就記哪一國。資料照國家存，同一國問過一次就夠。",
 "auth.defaultNote":"每一隊有自己的帳號和資料。密碼預設是 password，想換可以登入後在選單裡改。",
 "menu.guestNote":"訪客模式：不會存到伺服器。用隊伍身分登入才能同步和公開。",
 "r.guestCant":"訪客模式不能公開或上傳，請用隊伍身分登入",
 "r.guestBanner":"你是訪客：這一頁只留在你的手機上，不會公開。要分享你們的機器人請用隊伍身分登入。"},

"zh-Hans":{"sc.modeAlly":"这场盟友","sc.modeVisit":"自由访问",
 "sc.allyH":"开打之前：选这一场的两个盟友，下去问他们。",
 "sc.visitH":"在维修区随便走，哪一国都能记，不一定要跟你们同队。",
 "sc.visitT":"维修区访问","sc.visitPick":"你现在在问哪一国？","sc.todo":"这次有来、还没问过的",
 "ab.scout":"两种用法：开打前选这场的两个盟友下去问；或者在维修区随便逛，遇到哪一国就记哪一国。资料按国家存，同一国问过一次就够。",
 "auth.defaultNote":"每一队有自己的账号和数据。密码默认是 password，想换可以登录后在菜单里改。",
 "menu.guestNote":"访客模式：不会存到服务器。用队伍身份登录才能同步和公开。",
 "r.guestCant":"访客模式不能公开或上传，请用队伍身份登录",
 "r.guestBanner":"你是访客：这一页只留在你的手机上，不会公开。要分享你们的机器人请用队伍身份登录。"}
};
/* 國家頁的官方戰績：每一場的比分、自己的爬升、聯盟爬升倍率 */
const OFFREC = {
en:{"n.offRec":"Official record","n.offAvgScore":"Avg alliance score","n.offAvgClimb":"Avg own climb","n.offClimbed":"Climbed",
 "n.offAvgMult":"Avg alliance ×","n.offStrip":"Climb, match by match","n.offPlayed":"Played","n.offNext":"Coming up",
 "n.offNoneYet":"No official matches played yet.","n.offW":"W","n.offL":"L","n.offT":"T","n.offAll":"Alliance",
 "n.offPartner":"Lifted a partner","n.offNoShow":"No show","n.offWith":"with","n.offNoClimb":"No climb","n.offScore":"Score",
 "n.offRobots":"Each robot's climb",
 "n.offNote":"From the official results. Climb is this robot's own BRACE position (+0.05 to +0.30). Alliance × is the whole alliance's climb multiplier, 1 + all three robots. Tap a match for the full breakdown."},
"zh-Hant":{"n.offRec":"官方戰績","n.offAvgScore":"平均聯盟得分","n.offAvgClimb":"平均自己爬升","n.offClimbed":"有爬升",
 "n.offAvgMult":"平均聯盟倍率","n.offStrip":"每一場爬到哪","n.offPlayed":"打過的","n.offNext":"接下來",
 "n.offNoneYet":"官方還沒有這一隊打完的比賽。","n.offW":"勝","n.offL":"敗","n.offT":"平","n.offAll":"聯盟",
 "n.offPartner":"有幫隊友爬","n.offNoShow":"沒上場","n.offWith":"隊友","n.offNoClimb":"沒爬","n.offScore":"比分",
 "n.offRobots":"每台機器人的爬升",
 "n.offNote":"資料來自官方成績。爬升是這台機器人自己在 BRACE 的位置（+0.05 到 +0.30）；聯盟 × 是整個聯盟的爬升倍率，等於 1 加上三台的爬升。點一場可以看完整計分。"},
"zh-Hans":{"n.offRec":"官方战绩","n.offAvgScore":"平均联盟得分","n.offAvgClimb":"平均自己爬升","n.offClimbed":"有爬升",
 "n.offAvgMult":"平均联盟倍率","n.offStrip":"每一场爬到哪","n.offPlayed":"打过的","n.offNext":"接下来",
 "n.offNoneYet":"官方还没有这一队打完的比赛。","n.offW":"胜","n.offL":"负","n.offT":"平","n.offAll":"联盟",
 "n.offPartner":"有帮队友爬","n.offNoShow":"没上场","n.offWith":"队友","n.offNoClimb":"没爬","n.offScore":"比分",
 "n.offRobots":"每台机器人的爬升",
 "n.offNote":"数据来自官方成绩。爬升是这台机器人自己在 BRACE 的位置（+0.05 到 +0.30）；联盟 × 是整个联盟的爬升倍率，等于 1 加上三台的爬升。点一场可以看完整计分。"}
};
Object.keys(OFFREC).forEach(function(l){ Object.assign(ADD[l], OFFREC[l]); });
/* 遊戲式排位：段位名稱、晉級進度、圖表 */
const RANKED = {
en:{"rk.t.chal":"Challenger","rk.t.master":"Master","rk.t.dia":"Diamond","rk.t.plat":"Platinum","rk.t.gold":"Gold",
 "rk.t.silver":"Silver","rk.t.bronze":"Bronze","rk.t.unr":"Placements","rk.tierYou":"Your tier",
 "rk.promoTo":"{n} places to {t}","rk.toFirst":"{n} places from #1","rk.atTop":"Top of the ladder",
 "rk.placement":"In placements: no official match played yet.","rk.winRate":"Win rate","rk.avgClimb":"Avg climb",
 "rk.trend":"Rank over time","rk.trendH":"Each point is an official update across the event; higher on the chart is a better rank.",
 "rk.best":"Best","rk.table":"Show the numbers","rk.update":"Update","rk.rankCol":"Rank","rk.tierCol":"Tier",
 "rk.dist":"Tier distribution","rk.distH":"How many teams sit in each tier. Yours is highlighted; tap a tier to jump to it.",
 "rk.teams":"teams","rk.podium3":"Top 3","rk.podium3c":"Top 3 on this continent","rk.cut":"Playoff line · top 24",
 "n.scoreChart":"Alliance score per match"},
"zh-Hant":{"rk.t.chal":"王者","rk.t.master":"大師","rk.t.dia":"鑽石","rk.t.plat":"白金","rk.t.gold":"黃金",
 "rk.t.silver":"白銀","rk.t.bronze":"青銅","rk.t.unr":"定級中","rk.tierYou":"你們的段位",
 "rk.promoTo":"再前進 {n} 名升上 {t}","rk.toFirst":"距離第 1 名還差 {n} 名","rk.atTop":"站上頂端了",
 "rk.placement":"定級中：還沒打過正式比賽。","rk.winRate":"勝率","rk.avgClimb":"平均爬升",
 "rk.trend":"名次走勢","rk.trendH":"每一點是整個賽事中的一次官方更新；越上面名次越好。",
 "rk.best":"最佳","rk.table":"顯示數字","rk.update":"更新時間","rk.rankCol":"名次","rk.tierCol":"段位",
 "rk.dist":"段位分布","rk.distH":"每個段位有幾隊。你們的段位會亮起來；點一個段位直接跳過去。",
 "rk.teams":"隊","rk.podium3":"頂尖三強","rk.podium3c":"這一洲的前三名","rk.cut":"季後賽晉級線 · 前 24 名",
 "n.scoreChart":"每一場的聯盟得分"},
"zh-Hans":{"rk.t.chal":"王者","rk.t.master":"大师","rk.t.dia":"钻石","rk.t.plat":"白金","rk.t.gold":"黄金",
 "rk.t.silver":"白银","rk.t.bronze":"青铜","rk.t.unr":"定级中","rk.tierYou":"你们的段位",
 "rk.promoTo":"再前进 {n} 名升上 {t}","rk.toFirst":"距离第 1 名还差 {n} 名","rk.atTop":"站上顶端了",
 "rk.placement":"定级中：还没打过正式比赛。","rk.winRate":"胜率","rk.avgClimb":"平均爬升",
 "rk.trend":"名次走势","rk.trendH":"每一点是整个赛事中的一次官方更新；越上面名次越好。",
 "rk.best":"最佳","rk.table":"显示数字","rk.update":"更新时间","rk.rankCol":"名次","rk.tierCol":"段位",
 "rk.dist":"段位分布","rk.distH":"每个段位有几队。你们的段位会亮起来；点一个段位直接跳过去。",
 "rk.teams":"队","rk.podium3":"顶尖三强","rk.podium3c":"这一洲的前三名","rk.cut":"季后赛晋级线 · 前 24 名",
 "n.scoreChart":"每一场的联盟得分"}
};
Object.keys(RANKED).forEach(function(l){ Object.assign(ADD[l], RANKED[l]); });
const STALE = ["auth.defaultNote","menu.guestNote","r.guestCant","r.guestBanner","ab.scout"];
Object.keys(I).forEach(function(l){ if(!ADD[l]) STALE.forEach(function(k){ delete I[l][k]; }); });
Object.keys(ADD).forEach(function(l){ I[l]=Object.assign(I[l]||{},ADD[l]); });
})();
