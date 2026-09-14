# FGC 2026 Igniting Innovation — Scouting 網站規格（English-first UI，中文為內部註解）

網站：`D:\FGC2026\web\`（`index.html` + `app.css` + `app.js` + `nations.js` + 官方 logo / 海報），由 `server.py` 提供。
每一個參賽國家就是一個帳號，資料各自獨立；「Our robot」機器介紹與照片可發布給所有隊看。

> 設計原則：**像點菜單一樣操作** —— 國家用下拉（附國旗、可搜尋英文/中文、可自己加不在名單的隊），能力用一鍵選項，只有「顆數 / 秒數」用數字格。中文提示用白話（例：機器能裝多少球）。
> 賽制重點：**沒有自控**，2:30 全手控；每場 6 台（紅藍各 3 台，隨機分組，所以每場有 2 個盟友）；不准防守（G01）；持球量無上限（G12）。

---

## 0. 登入（每隊先選自己是誰）

| 步驟 | 內容 |
|---|---|
| Who are you? | 下拉選自己的國家（175 隊，來源 first.global；名單若有缺可在 `web/nations.js` 加） |
| Team password | 所有國家預設密碼 **password** |
| 第一次登入 | 會請你改成自己隊的密碼（全隊共用，至少 4 字），也可以按 **Skip for now** 先沿用預設；忘記密碼 → 主辦執行 `python server.py --reset-password <slug>` |
| 之後 | 右上角國旗徽章 → 改密碼 / 登出。同一隊所有裝置自動同步；不同隊互相看不到彼此的 scouting 資料 |

離線單檔 `FGC2026_Scouting.html`（`python build_single.py` 產生）：iPad 直接開檔可用，但不同步、不能登入/發布。

---

## 1. Match（比賽記錄 — 一場填兩個隊友，各一張卡）

上方：**WE ARE 〈自己的國家〉**（登入時就決定，不用再選）、Match 場次、Our alliance 紅/藍。
下方兩張卡 **Teammate A / Teammate B**：各自先選國家（選了才展開題目），每一國的數據分開記，不合併。

| 欄位 (EN) | 中文提示 | 類型 | 說明 |
|---|---|---|---|
| Match | 第幾場 | 數字 stepper | 儲存後自動 +1 |
| Our alliance | 我們這場是 | 單選 | 🔴 RED / 🔵 BLUE（整個聯盟共用） |
| Teammate A / B → 國家 | 哪一國？ | 下拉（國旗＋搜尋） | 兩張卡不能選同一國 |
| Into SUPPRESSION UNIT | 投進滅火桶幾顆 | 數字（±1 / ±5） | 1 pt/顆；開口 165 cm |
| Into FIRE SHIELD PORT | 推進角落洞口幾顆 | 數字（±1 / ±5） | 給 HUMAN PLAYER 投 |
| End-of-match position | 最後爬到哪 | 單選 | None / Contact / Zone 1 / 2 / 3 |
| Partners carried | 背了幾台隊友 | 單選 | 0 / 1 / 2（25 pt/台） |
| Was carried | 有被隊友背嗎 | 單選 | No / Yes |
| Started climbing at | 剩幾秒開始爬 | 單選 | ≥60 / 45 / 30 / 20 / ≤10 s |
| Robot status | 機器有沒有出狀況 | 單選 | OK / Stuck-tipped / Dead / Late start |
| Card | 有被判牌嗎 | 單選 | None / ⚪ / 🟡 / 🔴 |
| Driver rating | 駕駛順不順 | 單選 1–5 | |
| Notes | 想補充什麼 | 文字 | |

按一次 **Save · next match** 會同時存下 A、B 兩筆（只填一個也可以），場次自動 +1、表單清空。
每筆自動記下同場的另一個隊友與我們自己（p1 / p2），所以事後看得出當時的三隊組合。
下方「Recorded」列表點一下可以把整場（A+B）叫回來修改。

---

## 2. Pit（維修區訪談，一隊一筆，自動存檔）

若該隊已發布自己的機器介紹，Pit 最上方會先顯示「📢 Self-reported by …」，一鍵可帶入成我們的答案。

**Shooting 投球**

| 欄位 (EN) | 中文提示 | 類型 | 選項 |
|---|---|---|---|
| Ball capacity | 機器能裝多少球 | 數字 | |
| Shooter type | 射球方式 | 單選 | Single 單通道 / Dual 雙通道 / Triple 三通道 / Waterfall 瀑布流 |
| Time to empty a full load | 射完一倉球要幾秒 | 數字（±1 / ±5） | |
| Can score in the SUPPRESSION UNIT? | 射得進 165 cm 高的滅火桶嗎 | 三段 | ✓ Reliable / △ Sometimes / ✗ No |
| Can push balls into the PORT? | 能把球推進角落洞口嗎 | 三段 | ✓ / △ / ✗ |

**BRACE climb 爬升**（跟之前一樣）

| Highest zone reached | 最高能爬到哪 | 單選 | None / Contact / Zone 1 / Zone 2 / Zone 3 |
|---|---|---|---|
| Seconds to get there | 爬上去要幾秒 | 數字 | |
| Can carry a partner / Can be carried | 能背隊友 / 能被背 | 勾選 | |

**Preferred field position 在場上喜歡站哪**（可複選；點場地圖或點選項都可以）

| Own wall | 靠自己這邊的牆（REGIONAL ZONE） |
|---|---|
| Shooting line | 滅火桶前面投球 |
| Center pile | 中間撿球（EXTINGUISHER 下方出球處） |
| Corner PORT | 自己角落的洞口 |
| Brace lane | 爬梯那條線 |
| Roaming | 到處跑 |

**Role & comms**：Preferred roles（Shooter / Port feeder / Climber / Carrier）、Human player skill 1–5、Drivetrain（Tank / Mecanum / Omni）、Languages、Breakdowns today、Notes。
**3-min alliance huddle 賽前跟隊友講好**：開場誰衝中間、誰投誰餵、爬升順序誰背誰、剩 30 秒開始爬、舉手＝卡住別撞我。

---

## 3. Nations（各國 · 國家主頁大廳）

- 上方下拉「Look up a nation」→ 打開該國頁面；下方是我們的排名（Balls / Climb / Reliability / Matches），點一隊也會打開國家頁。
- 國家頁內容：大國旗 hero、**Power 戰力分數 0–100**（🔥 Elite ≥80 / 💪 Strong ≥60 / 👍 Solid ≥40 / 🌱 Developing）、機器照片（若該隊有上傳）、**六維雷達圖**（Shooting 投得準 / Firepower 裝得多 / Speed 射得快 / Climb 爬升 / Support 背隊友 / Feeding 餵洞口；橘＝該隊自己說的，藍＝我們 Pit 問到的）、我們記錄到的比賽數據（場數、平均投球、平均 PORT、爬升率、最高爬升、故障）、他們自己的介紹、我們的 Pit 備註、「Scout them in Pit」。
- 戰力權重：Shooting 25% / Firepower 20% / Speed 15% / Climb 25% / Support 10% / Feeding 5%（自己說的優先，沒有就用我們的 Pit 資料）。

---

## 4. Robot（我們的機器介紹，開源給所有隊）

與 Pit 相同的欄位（裝幾球、射球方式、射完一倉幾秒、投得進嗎、推洞口、爬升、背人、喜歡站哪、角色、HP、底盤、語言）＋ 英文自由描述 ＋ **照片（最多 4 張，裝置端縮到 1280px 再上傳）** ＋ 「Publish to all teams」開關（一按就立刻上傳，不用再按 Save）。其他欄位按 Save 才送出；發布後其他隊在 Pit / Nations 看得到。

---

## 5. Score（計分機）

REGIONAL ALLIANCE 分數 = ⌈SUPPRESSION × (1 + Σ 三台 CLIMB MULTIPLIER)⌉ + 25 × 被背隊友數 + EXTINGUISHER + COOPERTITION（4 / 5 / 6 台上 Zone 3 → +10 / +25 / +40）。倍率依手冊「increment」語意；官方計算機為 JS 頁面無法逐字核對，有差異以官方為準。

---

## 6. 排名與淘汰賽（挑隊友時要知道）

- 排名 = 各場分數平均、**去掉最低一場**（RED CARD 那場不能去掉）；同分看單場最高，再看 SUPPRESSION 總分。
- 前 24 名自動分進 8 個聯盟（每聯盟 4 隊，蛇形 + 第 25 名以後抽籤），每場只出 3 台。

---

## 6.5 裝到手機（iOS 描述檔 / PWA）

- **安裝頁**：`/install`（不用登入就能開，20 種語言）。App 內 Data 分頁也有捷徑。
- **iPhone / iPad**：按「Download install profile」→ 下載 **Web Clip 設定描述檔**（`/install.mobileconfig`）→ 設定 → 已下載描述檔 → 安裝 → 主畫面出現圖示，開起來是全螢幕、沒有 Safari 網址列。
  - 描述檔由伺服器**即時產生**，URL 就是你當下連進來的網址（隧道或區網都對）；圖示用官方 logo 180×180。
  - 未簽章，所以 iOS 會顯示「未驗證」——它只加一個主畫面圖示（`com.apple.webClip.managed`），不改任何其他設定，隨時可在「設定 → 一般 → VPN 與裝置管理」移除。
  - 不想裝描述檔也可以：Safari 分享 ⬆︎ →「加入主畫面」（效果一樣）。
- **Android / 電腦**：Chrome 會跳安裝提示（manifest.webmanifest，standalone、直式、火焰主題色）。
- **離線**：`sw.js` 會快取整個網站外殼（HTML/CSS/JS/翻譯/圖示），國旗與照片用到才快取，`/api/` 一律不快取。需要 https（隧道）或 localhost；純區網 http 不會註冊 Service Worker，但 app 本來就能離線填寫（localStorage）。
- ⚠️ **隧道網址每次重開都會變**，描述檔裡的網址是下載當下那一個。網址換了要重裝一次；長期用建議固定網域或會場內用固定的區網 IP。

---

## 7. 系統

- `server.py`：靜態站 + API（`/api/login`、`/api/me`、`/api/password`、`/api/logout`、`/api/state`、`/api/sync`、`/api/profile`、`/api/profiles`、`/api/photo`、`/api/photo/delete`）；資料在 `data/`（`accounts.json` PBKDF2 雜湊、`sessions.json`、`teams/<slug>.json`、`profiles.json`、`photos/`），每日備份 `backups/`。登入失敗 5 分鐘內 8 次會暫停。
- 同步：每 8 秒 POST `/api/sync`（X-Token），以時間戳合併；離線照常可填。機器介紹每 60 秒更新一次。
- 照片網址 `/photos/<slug>/<hex>.jpg` 是公開的（不含機密）。
- 匯出：Match / Pit / Team summary CSV、JSON 備份。主題：跟隨系統 / 淺色 / 深色。
- 語言：右上角 🌐 可切換 20 種語言（English 預設、繁體中文、简体中文、Español、Français、العربية、हिन्दी、বাংলা、Português、Русский、اردو、Bahasa Indonesia、Deutsch、日本語、한국어、Türkçe、Tiếng Việt、Kiswahili、فارسی、Italiano）；阿拉伯文/烏爾都文/波斯文自動切換為由右至左。缺字自動退回英文。
- 國旗：`web/flags/<iso>.svg`（175 面，本機提供；Windows 不顯示 emoji 國旗所以改用圖片）。
- 安裝：`/install` 安裝頁、`/install.mobileconfig`（動態產生的 iOS Web Clip 描述檔）、`manifest.webmanifest`、`sw.js` 離線快取。
- 視覺：Igniting Innovation 火焰主題 —— 官方 logo（分頁圖示會呼吸發光）、aurora 漸層背景、火星粒子、山火天際線。頁尾 Made with ♥ in Chinese Taipei 🇹🇼。
