// FGC 2026 Scouting — translations part 9: pit visits (record any team, not only this match's allies)
// and sign-in without claim codes (every nation starts with the password "password").
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
const STALE = ["auth.defaultNote","menu.guestNote","r.guestCant","r.guestBanner","ab.scout"];
Object.keys(I).forEach(function(l){ if(!ADD[l]) STALE.forEach(function(k){ delete I[l][k]; }); });
Object.keys(ADD).forEach(function(l){ I[l]=Object.assign(I[l]||{},ADD[l]); });
})();
