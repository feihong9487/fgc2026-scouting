// FGC 2026 Scouting - claim link tool
//
// Pick a nation, press a button, the message to send that team is on your
// clipboard. Wraps the server's --claim-link / --reset-password / --audit
// commands so you do not have to remember ssh syntax at a competition.
//
// Build:  tools\build.ps1      (uses csc.exe, which ships with Windows)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

public class ClaimForm : Form
{
    // slug|English name, filled in at build time from web/nations.js
    static readonly string[] RAW = new string[] {
// NATIONS_PLACEHOLDER
    };

    const string DEF_SERVER = "root@fgc-scout.duckdns.org";
    const string DEF_KEY = @"%USERPROFILE%\.ssh\id_ed25519_fgc";

    ComboBox cbNation;
    Button btnLink, btnReissue, btnAudit;
    TextBox txtOut, txtServer, txtKey;
    Label lblStatus;
    CheckBox chkSettings;
    Panel pnlSettings;

    readonly Dictionary<string, string> slugByLabel = new Dictionary<string, string>();
    string iniPath;

    public ClaimForm()
    {
        Text = "FGC 2026 - 認領連結";
        Size = new Size(760, 620);
        MinimumSize = new Size(640, 520);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(24, 24, 28);
        ForeColor = Color.WhiteSmoke;
        Font = new Font("Segoe UI", 10f);

        iniPath = Path.Combine(
            Path.GetDirectoryName(Application.ExecutablePath) ?? ".", "claimtool.ini");

        var lblPick = new Label {
            Text = "選一個國家（可以直接打字搜尋）", AutoSize = true,
            Location = new Point(16, 14), ForeColor = Color.Gainsboro };

        cbNation = new ComboBox {
            Location = new Point(16, 38), Width = 470,
            DropDownStyle = ComboBoxStyle.DropDown,
            AutoCompleteMode = AutoCompleteMode.SuggestAppend,
            AutoCompleteSource = AutoCompleteSource.ListItems,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(38, 38, 44), ForeColor = Color.WhiteSmoke };

        var labels = new List<string>();
        foreach (var row in RAW)
        {
            var bits = row.Split('|');
            if (bits.Length < 2) continue;
            var label = bits[1] + "  (" + bits[0] + ")";
            slugByLabel[label] = bits[0];
            labels.Add(label);
        }
        labels.Sort(StringComparer.OrdinalIgnoreCase);
        cbNation.Items.AddRange(labels.Cast<object>().ToArray());

        btnLink = MakeButton("取得認領連結", new Point(500, 37), 210, Color.FromArgb(232, 92, 42));
        btnLink.Click += (s, e) => Run("link");

        btnReissue = MakeButton("重發（被鎖在外面時）", new Point(16, 82), 236, Color.FromArgb(58, 58, 66));
        btnReissue.Click += (s, e) => {
            var slug = Slug();
            if (slug == null) return;
            var ok = MessageBox.Show(
                "這會把 " + slug + " 現在的帳號作廢，該隊所有裝置都會被登出。\n" +
                "他們的 scouting 資料不會動。\n\n要繼續嗎？",
                "確認重發", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (ok == DialogResult.Yes) Run("reissue");
        };

        btnAudit = MakeButton("看最近的登入紀錄", new Point(262, 82), 224, Color.FromArgb(58, 58, 66));
        btnAudit.Click += (s, e) => Run("audit");

        chkSettings = new CheckBox {
            Text = "伺服器設定", Location = new Point(500, 86), AutoSize = true,
            ForeColor = Color.Gainsboro };
        chkSettings.CheckedChanged += (s, e) => pnlSettings.Visible = chkSettings.Checked;

        pnlSettings = new Panel {
            Location = new Point(16, 114), Size = new Size(694, 74), Visible = false,
            BackColor = Color.FromArgb(32, 32, 38) };
        pnlSettings.Controls.Add(new Label { Text = "Server", Location = new Point(8, 10), AutoSize = true, ForeColor = Color.Gainsboro });
        txtServer = new TextBox { Location = new Point(70, 7), Width = 600, BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(44, 44, 50), ForeColor = Color.WhiteSmoke };
        pnlSettings.Controls.Add(txtServer);
        pnlSettings.Controls.Add(new Label { Text = "SSH key", Location = new Point(8, 42), AutoSize = true, ForeColor = Color.Gainsboro });
        txtKey = new TextBox { Location = new Point(70, 39), Width = 600, BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(44, 44, 50), ForeColor = Color.WhiteSmoke };
        pnlSettings.Controls.Add(txtKey);

        txtOut = new TextBox {
            Location = new Point(16, 198), Size = new Size(694, 330),
            Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
            BorderStyle = BorderStyle.FixedSingle, Font = new Font("Consolas", 9.5f),
            BackColor = Color.FromArgb(18, 18, 22), ForeColor = Color.FromArgb(160, 235, 160) };

        lblStatus = new Label {
            Location = new Point(16, 536), AutoSize = true, ForeColor = Color.Gainsboro,
            Text = "選一個國家，按「取得認領連結」。訊息會自動複製到剪貼簿。" };

        Controls.AddRange(new Control[] {
            lblPick, cbNation, btnLink, btnReissue, btnAudit, chkSettings, pnlSettings, txtOut, lblStatus });

        Resize += (s, e) => {
            txtOut.Size = new Size(ClientSize.Width - 32, ClientSize.Height - 260);
            lblStatus.Location = new Point(16, ClientSize.Height - 46);
            btnLink.Location = new Point(ClientSize.Width - 244, 37);
            cbNation.Width = ClientSize.Width - 280;
            chkSettings.Location = new Point(ClientSize.Width - 244, 86);
            pnlSettings.Width = ClientSize.Width - 32;
            txtServer.Width = pnlSettings.Width - 90;
            txtKey.Width = pnlSettings.Width - 90;
        };

        LoadIni();
        cbNation.Focus();
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
        try
        {
            if (!File.Exists(iniPath)) return;
            foreach (var line in File.ReadAllLines(iniPath))
            {
                var i = line.IndexOf('=');
                if (i <= 0) continue;
                var k = line.Substring(0, i).Trim();
                var v = line.Substring(i + 1).Trim();
                if (k == "server" && v.Length > 0) txtServer.Text = v;
                if (k == "key" && v.Length > 0) txtKey.Text = v;
            }
        }
        catch { }
    }

    void SaveIni()
    {
        try { File.WriteAllText(iniPath, "server=" + txtServer.Text + "\r\nkey=" + txtKey.Text + "\r\n"); }
        catch { }
    }

    string Slug()
    {
        var text = (cbNation.Text ?? "").Trim();
        if (text.Length == 0) { Status("先選一個國家。", true); return null; }
        string slug;
        if (slugByLabel.TryGetValue(text, out slug)) return slug;
        // 使用者可能直接打 slug
        var guess = text.ToLowerInvariant().Replace(' ', '-');
        if (slugByLabel.Values.Contains(guess)) return guess;
        Status("找不到「" + text + "」。從下拉選單選，或直接打小寫代號，例如 costa-rica。", true);
        return null;
    }

    void Status(string msg, bool bad)
    {
        lblStatus.Text = msg;
        lblStatus.ForeColor = bad ? Color.FromArgb(245, 120, 110) : Color.FromArgb(140, 225, 150);
    }

    void Busy(bool on)
    {
        btnLink.Enabled = btnReissue.Enabled = btnAudit.Enabled = cbNation.Enabled = !on;
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
                         " && systemctl restart fgc-scouting && sleep 2 && sudo -u fgc python3 server.py --claim-link " + slug;
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
                        Status(slug + " 已經有人認領了。真的被鎖在外面才按「重發」。", true);
                    else
                        Status("沒有拿到連結，看上面的輸出。", true);
                    return;
                }

                var msg =
                    "Here is your team's sign-in link for the FGC 2026 scouting app:\r\n" + link + "\r\n\r\n" +
                    "Open it on your phone and choose a password for your whole team. Everyone on\r\n" +
                    "your team uses that same password, so agree on it together and write it down.\r\n" +
                    "The link works once and is only for your team - please don't share it.";
                txtOut.Text = msg + "\r\n\r\n------- 伺服器輸出 -------\r\n" + body;
                try { Clipboard.SetText(msg); Status("已複製到剪貼簿。私訊給 " + slug + "，不要貼群組。", false); }
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
        return "ssh";   // 賭 PATH 裡有
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

    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ClaimForm());
    }
}
