// FGC 2026 Scouting - claim link tool
//
// Pick a nation, press a button, the message to send that team is on your
// clipboard. Wraps the server's --claim-link / --reset-password / --audit
// commands so you do not have to remember ssh syntax at a competition.
//
// The nation list is pulled from the live site at start-up rather than baked
// in, because a baked-in list goes stale silently: the first build shipped
// with 175 nations and could not issue a link for the 32 added later. The
// built-in copy is only the offline fallback.
//
// Build:  python tools\build.py     (uses csc.exe, which ships with Windows)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

public class ClaimForm : Form
{
    // slug|English name, baked in at build time from web/nations.js. Fallback only.
    static readonly string[] RAW = new string[] {
// NATIONS_PLACEHOLDER
    };

    const string DEF_SERVER = "root@fgc-scout.duckdns.org";
    const string DEF_KEY = @"%USERPROFILE%\.ssh\id_ed25519_fgc";
    const string DEF_SITE = "https://fgc-scout.duckdns.org/";

    ComboBox cbNation;
    Button btnLink, btnReissue, btnAudit, btnRefresh;
    TextBox txtOut, txtServer, txtKey, txtSite;
    Label lblStatus, lblCount;
    CheckBox chkSettings, chkHideClaimed;
    Panel pnlSettings;

    // 下拉選單裡放的是物件，不是字串。顯示文字怎麼變都不影響拿到的 slug。
    public class Nat
    {
        public string Slug, Name, Status;
        // 標記放在後面：放前面的話每個項目都以空白開頭，打字自動補完永遠對不上
        public override string ToString()
        {
            return Name + "  (" + Slug + ")" + (Status == "claimed" ? "  ●" : "");
        }
    }

    readonly Dictionary<string, string> nameBySlug = new Dictionary<string, string>();
    readonly Dictionary<string, string> statusBySlug = new Dictionary<string, string>();
    bool pendingRefill;
    string iniPath;

    public ClaimForm()
    {
        Text = "FGC 2026 - 認領連結";
        Size = new Size(780, 660);
        MinimumSize = new Size(660, 540);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(24, 24, 28);
        ForeColor = Color.WhiteSmoke;
        Font = new Font("Segoe UI", 10f);

        iniPath = Path.Combine(
            Path.GetDirectoryName(Application.ExecutablePath) ?? ".", "claimtool.ini");

        var lblPick = new Label {
            Text = "選一個國家（可以直接打字搜尋）", AutoSize = true,
            Location = new Point(16, 14), ForeColor = Color.Gainsboro };

        lblCount = new Label {
            Text = "", AutoSize = true, Location = new Point(250, 14),
            ForeColor = Color.FromArgb(150, 150, 160) };

        cbNation = new ComboBox {
            Location = new Point(16, 38), Width = 470,
            DropDownStyle = ComboBoxStyle.DropDown,
            AutoCompleteMode = AutoCompleteMode.SuggestAppend,
            AutoCompleteSource = AutoCompleteSource.ListItems,
            FlatStyle = FlatStyle.Flat, MaxDropDownItems = 18,
            BackColor = Color.FromArgb(38, 38, 44), ForeColor = Color.WhiteSmoke };
        cbNation.SelectedIndexChanged += (s, e) => ShowPicked();
        cbNation.LostFocus += (s, e) => { if (pendingRefill) FillCombo(); };

        btnLink = MakeButton("取得認領連結", new Point(500, 37), 210, Color.FromArgb(232, 92, 42));
        btnLink.Click += (s, e) => Run("link");

        btnReissue = MakeButton("重發（被鎖在外面時）", new Point(16, 82), 210, Color.FromArgb(58, 58, 66));
        btnReissue.Click += (s, e) => {
            var slug = Slug();
            if (slug == null) return;
            var ok = MessageBox.Show(
                "這會把 " + slug + " 現在的帳號作廢，該隊所有裝置都會被登出。\n" +
                "他們的 scouting 資料不會動。\n\n要繼續嗎？",
                "確認重發", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (ok == DialogResult.Yes) Run("reissue");
        };

        btnAudit = MakeButton("看最近的登入紀錄", new Point(234, 82), 196, Color.FromArgb(58, 58, 66));
        btnAudit.Click += (s, e) => Run("audit");

        btnRefresh = MakeButton("重新整理名單", new Point(438, 82), 150, Color.FromArgb(58, 58, 66));
        btnRefresh.Click += (s, e) => LoadNations(true);

        chkHideClaimed = new CheckBox {
            Text = "只看還沒認領的", Location = new Point(600, 86), AutoSize = true,
            ForeColor = Color.Gainsboro };
        chkHideClaimed.CheckedChanged += (s, e) => FillCombo();

        chkSettings = new CheckBox {
            Text = "伺服器設定", Location = new Point(16, 116), AutoSize = true,
            ForeColor = Color.Gainsboro };
        chkSettings.CheckedChanged += (s, e) => { pnlSettings.Visible = chkSettings.Checked; Relayout(); };

        pnlSettings = new Panel {
            Location = new Point(16, 142), Size = new Size(710, 106), Visible = false,
            BackColor = Color.FromArgb(32, 32, 38) };
        pnlSettings.Controls.Add(Lab("Server", 8, 10));
        txtServer = Box(78, 7); pnlSettings.Controls.Add(txtServer);
        pnlSettings.Controls.Add(Lab("SSH key", 8, 42));
        txtKey = Box(78, 39); pnlSettings.Controls.Add(txtKey);
        pnlSettings.Controls.Add(Lab("網址", 8, 74));
        txtSite = Box(78, 71); pnlSettings.Controls.Add(txtSite);

        txtOut = new TextBox {
            Location = new Point(16, 152), Size = new Size(710, 360),
            Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
            BorderStyle = BorderStyle.FixedSingle, Font = new Font("Consolas", 9.5f),
            BackColor = Color.FromArgb(18, 18, 22), ForeColor = Color.FromArgb(160, 235, 160) };

        lblStatus = new Label {
            Location = new Point(16, 520), AutoSize = true, ForeColor = Color.Gainsboro,
            Text = "正在抓國家名單…" };

        Controls.AddRange(new Control[] {
            lblPick, lblCount, cbNation, btnLink, btnReissue, btnAudit, btnRefresh,
            chkHideClaimed, chkSettings, pnlSettings, txtOut, lblStatus });

        Resize += (s, e) => Relayout();

        LoadIni();
        FillCombo();                 // 先用內建名單，網路回來再換掉
        LoadNations(false);
        cbNation.Focus();
    }

    Label Lab(string t, int x, int y) {
        return new Label { Text = t, Location = new Point(x, y), AutoSize = true, ForeColor = Color.Gainsboro };
    }
    TextBox Box(int x, int y) {
        return new TextBox { Location = new Point(x, y), Width = 610, BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(44, 44, 50), ForeColor = Color.WhiteSmoke };
    }

    void Relayout()
    {
        int top = pnlSettings.Visible ? 258 : 152;
        txtOut.Location = new Point(16, top);
        txtOut.Size = new Size(ClientSize.Width - 32, ClientSize.Height - top - 44);
        lblStatus.Location = new Point(16, ClientSize.Height - 34);
        btnLink.Location = new Point(ClientSize.Width - 244, 37);
        cbNation.Width = ClientSize.Width - 280;
        chkHideClaimed.Location = new Point(ClientSize.Width - 176, 86);
        pnlSettings.Width = ClientSize.Width - 32;
        txtServer.Width = txtKey.Width = txtSite.Width = pnlSettings.Width - 90;
    }

    Button MakeButton(string text, Point at, int w, Color bg)
    {
        var b = new Button {
            Text = text, Location = at, Size = new Size(w, 34),
            FlatStyle = FlatStyle.Flat, BackColor = bg, ForeColor = Color.White,
            UseVisualStyleBackColor = false };
        b.FlatAppearance.BorderSize = 0;
        return b;
    }

    void LoadIni()
    {
        txtServer.Text = DEF_SERVER;
        txtKey.Text = Environment.ExpandEnvironmentVariables(DEF_KEY);
        txtSite.Text = DEF_SITE;
        try
        {
            if (!File.Exists(iniPath)) return;
            foreach (var line in File.ReadAllLines(iniPath))
            {
                var i = line.IndexOf('=');
                if (i <= 0) continue;
                var k = line.Substring(0, i).Trim();
                var v = line.Substring(i + 1).Trim();
                if (v.Length == 0) continue;
                if (k == "server") txtServer.Text = v;
                if (k == "key") txtKey.Text = v;
                if (k == "site") txtSite.Text = v;
            }
        }
        catch { }
    }

    void SaveIni()
    {
        try {
            File.WriteAllText(iniPath,
                "server=" + txtServer.Text + "\r\nkey=" + txtKey.Text + "\r\nsite=" + txtSite.Text + "\r\n");
        } catch { }
    }

    // ---- nations -------------------------------------------------------

    void SeedFromRaw()
    {
        nameBySlug.Clear();
        foreach (var row in RAW)
        {
            var bits = row.Split('|');
            if (bits.Length >= 2) nameBySlug[bits[0]] = bits[1];
        }
    }

    void LoadNations(bool loud)
    {
        if (nameBySlug.Count == 0) SeedFromRaw();
        var site = txtSite.Text.Trim();
        var key = Environment.ExpandEnvironmentVariables(txtKey.Text.Trim());
        var server = txtServer.Text.Trim();
        if (loud) { Status("重新抓名單…", false); SaveIni(); }

        var t = new System.Threading.Thread(() =>
        {
            var fresh = FetchNations(site);
            string so, se;
            var code = Ssh(key, server, "cd /opt/fgc && sudo -u fgc python3 server.py --claim-status", out so, out se);
            var st = new Dictionary<string, string>();
            if (code == 0)
                foreach (var line in so.Split('\n'))
                {
                    var bits = line.Trim().Split('\t');
                    if (bits.Length == 2) st[bits[0]] = bits[1];
                }

            BeginInvoke((Action)(() =>
            {
                if (fresh != null && fresh.Count > 0)
                {
                    nameBySlug.Clear();
                    foreach (var kv in fresh) nameBySlug[kv.Key] = kv.Value;
                }
                statusBySlug.Clear();
                foreach (var kv in st) statusBySlug[kv.Key] = kv.Value;
                FillCombo();
                var claimed = statusBySlug.Values.Count(v => v == "claimed");
                if (fresh == null)
                    Status("連不上網站，用的是內建名單（" + nameBySlug.Count + " 國）。可能會缺新加的國家。", true);
                else if (st.Count == 0)
                    Status("名單已更新（" + nameBySlug.Count + " 國）。連不上伺服器，所以不知道誰已經認領。", true);
                else
                    Status(nameBySlug.Count + " 國，已認領 " + claimed + " 隊。選一個國家再按「取得認領連結」。", false);
            }));
        });
        t.IsBackground = true;
        t.Start();
    }

    static Dictionary<string, string> FetchNations(string site)
    {
        try
        {
            if (!site.EndsWith("/")) site += "/";
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;  // TLS 1.2
            using (var wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("User-Agent", "fgc2026-claimtool/1.0");
                var js = wc.DownloadString(site + "nations.js?t=" + DateTime.UtcNow.Ticks);
                var m = Regex.Match(js, @"window\.NATIONS\s*=\s*(\[.*?\]);", RegexOptions.Singleline);
                if (!m.Success) return null;
                var body = m.Groups[1].Value;
                var outp = new Dictionary<string, string>();
                foreach (Match e in Regex.Matches(body,
                    "\"slug\"\\s*:\\s*\"(.*?)\"\\s*,\\s*\"name\"\\s*:\\s*\"(.*?)\""))
                {
                    var slug = e.Groups[1].Value;
                    var name = Regex.Unescape(e.Groups[2].Value);
                    if (slug.Length > 0) outp[slug] = name;
                }
                return outp.Count > 0 ? outp : null;
            }
        }
        catch { return null; }
    }

    void FillCombo()
    {
        // 正在打字時不要抽換清單，不然打到一半的字會被洗掉，結果選到別的國家
        if (cbNation.Focused && (cbNation.Text ?? "").Trim().Length > 0)
        {
            pendingRefill = true;
            return;
        }
        pendingRefill = false;

        var keep = cbNation.Text;
        var items = new List<Nat>();
        foreach (var kv in nameBySlug)
        {
            string st;
            statusBySlug.TryGetValue(kv.Key, out st);
            if (chkHideClaimed.Checked && st == "claimed") continue;
            items.Add(new Nat { Slug = kv.Key, Name = kv.Value, Status = st });
        }
        items.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        cbNation.BeginUpdate();
        cbNation.Items.Clear();
        cbNation.Items.AddRange(items.Cast<object>().ToArray());
        cbNation.EndUpdate();
        cbNation.Text = keep;
        lblCount.Text = items.Count + " 國可選" + (chkHideClaimed.Checked ? "（已隱藏認領過的）" : "");
    }

    void ShowPicked()
    {
        var slug = SlugQuiet();
        if (slug == null) return;
        string st;
        statusBySlug.TryGetValue(slug, out st);
        if (st == "claimed")
            Status(nameBySlug[slug] + " 已經認領過了。真的被鎖在外面才按「重發」。", true);
        else
            Status(nameBySlug.ContainsKey(slug) ? nameBySlug[slug] + " 還沒認領，可以直接發連結。" : slug, false);
    }

    // 純函式，不碰任何控制項，所以 --selftest 測得到。
    // 這一段壞掉過：打 Kazakhstan 卻發出 Venezuela 的連結，所以現在寧可回 null 也不猜。
    public static string ResolveSlug(string text, Nat picked, Dictionary<string, string> nameBySlug)
    {
        text = (text ?? "").Trim();

        // 從選單挑的最可靠：項目物件自己帶著 slug，不用從顯示字串反推
        if (picked != null && string.Equals(picked.ToString(), text, StringComparison.Ordinal))
            return picked.Slug;

        if (text.Length == 0) return null;

        var bare = text;
        if (bare.EndsWith("●")) bare = bare.Substring(0, bare.Length - 1).Trim();

        // 先照整串比。有些隊名本身就帶括號，例如 Hope (Refugees)，
        // 先砍括號會把它切成 "Refugees" 然後什麼都找不到。
        var hit = Exact(bare, nameBySlug);
        if (hit != null) return hit;

        // 再處理「國名  (slug)」這種顯示格式，而且括號裡真的要是一個代號才砍
        var par = bare.LastIndexOf('(');
        if (par > 0 && bare.EndsWith(")"))
        {
            var inside = bare.Substring(par + 1, bare.Length - par - 2).Trim();
            if (nameBySlug.ContainsKey(inside)) return inside;
            var head = bare.Substring(0, par).Trim();
            hit = Exact(head, nameBySlug);
            if (hit != null) return hit;
        }
        return null;      // 對不上就是對不上，不猜。猜錯等於把別國的帳號發給別人。
    }

    static string Exact(string s, Dictionary<string, string> nameBySlug)
    {
        if (s.Length == 0) return null;
        if (nameBySlug.ContainsKey(s)) return s;
        var dashed = s.ToLowerInvariant().Replace(' ', '-');
        if (nameBySlug.ContainsKey(dashed)) return dashed;
        foreach (var kv in nameBySlug)
            if (string.Equals(kv.Value, s, StringComparison.OrdinalIgnoreCase)) return kv.Key;
        return null;
    }

    string SlugQuiet()
    {
        return ResolveSlug(cbNation.Text, cbNation.SelectedItem as Nat, nameBySlug);
    }

    string Slug()
    {
        var slug = SlugQuiet();
        if (slug != null) return slug;
        Status("找不到「" + cbNation.Text.Trim() + "」。從下拉選單選，或直接打小寫代號，例如 costa-rica。", true);
        return null;
    }

    void Status(string msg, bool bad)
    {
        lblStatus.Text = msg;
        lblStatus.ForeColor = bad ? Color.FromArgb(245, 120, 110) : Color.FromArgb(140, 225, 150);
    }

    void Busy(bool on)
    {
        btnLink.Enabled = btnReissue.Enabled = btnAudit.Enabled = btnRefresh.Enabled = cbNation.Enabled = !on;
        Cursor = on ? Cursors.WaitCursor : Cursors.Default;
    }

    void Run(string what)
    {
        string slug = null;
        if (what != "audit")
        {
            slug = Slug();
            if (slug == null) return;
        }
        SaveIni();
        Busy(true);
        Status("連線中…", false);
        txtOut.Text = "";

        var server = txtServer.Text.Trim();
        var key = Environment.ExpandEnvironmentVariables(txtKey.Text.Trim());

        var t = new System.Threading.Thread(() =>
        {
            string remote;
            if (what == "audit")
                remote = "cd /opt/fgc && sudo -u fgc python3 server.py --audit 40";
            else if (what == "reissue")
                remote = "cd /opt/fgc && sudo -u fgc python3 server.py --reset-password " + slug +
                         " && sudo -u fgc python3 server.py --claim-link " + slug;
            else
                remote = "cd /opt/fgc && sudo -u fgc python3 server.py --claim-link " + slug;

            string outText, errText;
            int code = Ssh(key, server, remote, out outText, out errText);
            var body = (outText + "\n" + errText).Trim();

            BeginInvoke((Action)(() =>
            {
                Busy(false);
                if (code != 0 && body.Length == 0)
                {
                    txtOut.Text = "連不上伺服器。檢查網路、SSH 金鑰路徑，或按「伺服器設定」確認位址。";
                    Status("失敗。", true);
                    return;
                }
                txtOut.Text = body;

                if (what == "audit") { Status("這是最近 40 筆。", false); return; }

                var link = FindLink(body);
                if (link == null)
                {
                    if (body.Contains("已經認領過") || body.Contains("已經被認領"))
                    {
                        statusBySlug[slug] = "claimed"; FillCombo();
                        Status(slug + " 已經有人認領了。真的被鎖在外面才按「重發」。", true);
                    }
                    else Status("沒有拿到連結，看上面的輸出。", true);
                    return;
                }

                var msg =
                    "Here is your team's sign-in link for the FGC 2026 scouting app:\r\n" + link + "\r\n\r\n" +
                    "Open it on your phone and choose a password for your whole team. Everyone on\r\n" +
                    "your team uses that same password, so agree on it together and write it down.\r\n" +
                    "The link works once and is only for your team - please don't share it.";
                txtOut.Text = msg + "\r\n\r\n------- 伺服器輸出 -------\r\n" + body;
                statusBySlug[slug] = "ready";
                // 連結裡的國家一定要跟按下去的那一國一致，否則就是發錯人，寧可什麼都不複製
                var inLink = Regex.Match(link, "claim=([a-z0-9-]+)").Groups[1].Value;
                if (inLink != slug)
                {
                    txtOut.Text = "伺服器回的是 " + inLink + " 的連結，但你選的是 " + slug
                                + "。沒有複製到剪貼簿，請重試。\r\n\r\n" + body;
                    Status("國家對不上，已經擋下來。", true);
                    return;
                }
                var who = nameBySlug.ContainsKey(slug) ? nameBySlug[slug] : slug;
                try { Clipboard.SetText(msg); Status("已複製到剪貼簿：" + who + "。私訊給他們，不要貼群組。", false); }
                catch { Status("剪貼簿用不了，手動複製上面那段。", true); }
            }));
        });
        t.IsBackground = true;
        t.Start();
    }

    static string FindLink(string body)
    {
        foreach (var line in body.Split('\n'))
        {
            var i = line.IndexOf("http");
            if (i < 0) continue;
            var frag = line.Substring(i).Trim();
            if (frag.Contains("claim=")) return frag;
        }
        return null;
    }

    static string FindSsh()
    {
        var candidates = new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", "ssh.exe"),
            @"C:\Program Files\Git\usr\bin\ssh.exe",
            @"C:\Program Files\OpenSSH\ssh.exe",
        };
        foreach (var c in candidates) if (File.Exists(c)) return c;
        return "ssh";
    }

    static int Ssh(string key, string server, string remote, out string stdout, out string stderr)
    {
        stdout = ""; stderr = "";
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = FindSsh(),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };
            psi.Arguments = "-i \"" + key + "\" -o BatchMode=yes -o LogLevel=ERROR " +
                            "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 " +
                            server + " \"" + remote.Replace("\"", "\\\"") + "\"";
            using (var p = Process.Start(psi))
            {
                stdout = p.StandardOutput.ReadToEnd();
                stderr = p.StandardError.ReadToEnd();
                p.WaitForExit(60000);
                return p.HasExited ? p.ExitCode : -1;
            }
        }
        catch (Exception ex) { stderr = ex.Message; return -1; }
    }

    // FGC-Claim.exe --selftest [網址]
    // 用線上真正的國家名單跑一遍解析，確認打字打到的就是拿到的那一國。
    static int SelfTest(string site)
    {
        var names = FetchNations(site);
        if (names == null || names.Count == 0)
        {
            Console.Error.WriteLine("連不上 " + site + " 的 nations.js");
            return 2;
        }
        Console.WriteLine("名單 " + names.Count + " 國，來源 " + site);

        Func<string, Nat> item = slug => new Nat { Slug = slug, Name = names[slug], Status = null };
        var cases = new List<string[]>
        {
            //  輸入,                             應該得到
            new[] { "Kazakhstan",                 "kazakhstan" },
            new[] { "kazakhstan",                 "kazakhstan" },
            new[] { "New Zealand",                "new-zealand" },
            new[] { "new-zealand",                "new-zealand" },
            new[] { "Thailand",                   "thailand" },
            new[] { "Chinese Taipei",             "chinese-taipei" },
            new[] { "Costa Rica",                 "costa-rica" },
            new[] { "  Kazakhstan  ",             "kazakhstan" },
            new[] { "Kazakhstan  (kazakhstan)",   "kazakhstan" },
            new[] { "Malta  (malta)  ●",          "malta" },
            new[] { "Venezuela",                  "venezuela" },
            new[] { "Hope (Refugees)",            "hope" },          // 隊名自己就有括號
            new[] { "Hope (Refugees)  (hope)",    "hope" },
            new[] { "Kazakh",                     null },        // 打一半，不准猜
            new[] { "Nowhereland",                null },
            new[] { "",                           null },
        };

        int bad = 0;
        foreach (var c in cases)
        {
            var got = ResolveSlug(c[0], null, names);
            var ok = got == c[1];
            if (!ok) bad++;
            Console.WriteLine((ok ? "  ok   " : "  FAIL ") + "\"" + c[0] + "\" -> "
                              + (got ?? "(拒絕)") + (ok ? "" : "   應該是 " + (c[1] ?? "(拒絕)")));
        }

        // 每一國都要能用自己的名字和 slug 找回自己
        int drift = 0;
        foreach (var kv in names)
        {
            if (ResolveSlug(kv.Value, null, names) != kv.Key) { drift++; if (drift < 6) Console.WriteLine("  FAIL 用國名找不回來: " + kv.Value); }
            if (ResolveSlug(kv.Key, null, names) != kv.Key) { drift++; if (drift < 6) Console.WriteLine("  FAIL 用代號找不回來: " + kv.Key); }
            var n = item(kv.Key);
            if (ResolveSlug(n.ToString(), n, names) != kv.Key) { drift++; if (drift < 6) Console.WriteLine("  FAIL 從選單挑也不對: " + kv.Key); }
        }
        Console.WriteLine(drift == 0 ? "  ok   " + names.Count + " 國，名字/代號/選單三種方式都對得回自己"
                                     : "  FAIL 有 " + drift + " 個對不回自己");
        bad += drift;
        Console.WriteLine(bad == 0 ? "\n全部通過" : "\n有 " + bad + " 項失敗");
        return bad == 0 ? 0 : 1;
    }

    // FGC-Claim.exe --link <國名或代號>
    // 跟按下「取得認領連結」走完全一樣的路：解析 -> ssh -> 比對連結裡的國家 -> 印出要發的訊息。
    static int LinkCli(string who, string site, string server, string key)
    {
        var names = FetchNations(site);
        if (names == null || names.Count == 0) { Console.Error.WriteLine("連不上 " + site); return 2; }
        var slug = ResolveSlug(who, null, names);
        if (slug == null) { Console.Error.WriteLine("找不到「" + who + "」。用完整國名或小寫代號。"); return 3; }

        string so, se;
        var code = Ssh(key, server,
            "cd /opt/fgc && sudo -u fgc python3 server.py --claim-link " + slug, out so, out se);
        var body = ((so ?? "") + "\n" + (se ?? "")).Trim();
        if (code != 0 && body.Length == 0) { Console.Error.WriteLine("連不上伺服器"); return 4; }

        var link = FindLink(body);
        if (link == null) { Console.Error.WriteLine(body); return 5; }

        var inLink = Regex.Match(link, "claim=([a-z0-9-]+)").Groups[1].Value;
        if (inLink != slug)
        {
            Console.Error.WriteLine("國家對不上：選的是 " + slug + "，連結是 " + inLink + "。已擋下。");
            return 6;
        }
        Console.WriteLine("要發給 " + names[slug] + " (" + slug + ") 的訊息：");
        Console.WriteLine("Here is your team's sign-in link for the FGC 2026 scouting app:");
        Console.WriteLine(link);
        Console.WriteLine();
        Console.WriteLine("Open it on your phone and choose a password for your whole team. Everyone on");
        Console.WriteLine("your team uses that same password, so agree on it together and write it down.");
        Console.WriteLine("The link works once and is only for your team - please don't share it.");
        return 0;
    }

    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--selftest")
            return SelfTest(args.Length > 1 ? args[1] : DEF_SITE);
        if (args.Length > 1 && args[0] == "--link")
            return LinkCli(string.Join(" ", args.Skip(1).ToArray()), DEF_SITE, DEF_SERVER,
                           Environment.ExpandEnvironmentVariables(DEF_KEY));

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ClaimForm());
        return 0;
    }
}
