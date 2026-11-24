using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

// AGY Git Graph - SSH 通道安裝程式（Windows 用戶端）
//
// 給「在這台電腦用 Claude 桌面版，透過 SSH 連到遠端機器開發」的使用者：
// Git Graph 伺服器跑在遠端，右側瀏覽器窗格在這台電腦，需要由這台電腦建立 SSH 通道。
// 只安裝通道（不安裝 AGY 外掛與 Claude 技能），安裝至 %LOCALAPPDATA%\agy-git-graph\ssh-tunnel。
//
// 參數：/s 靜默；/uninstall 解除安裝（檔名含 uninstall 亦同）；
//       /tunnel <使用者@主機> [/port 22] [/local-port 52898] [/autostart]
namespace AgyGitGraphTunnelInstaller
{
    static class Program
    {
        const string ProductTitle = "AGY Git Graph SSH 通道";
        const int DefaultLocalPort = 52898;

        class TunnelState
        {
            public bool Configured;
            public bool Running;
            public bool Autostart;
            public string Target = "";
            public int Port = 22;
            public int LocalPort = DefaultLocalPort;
            public string Summary = "";
        }

        class TunnelChoice
        {
            public bool Setup;       // 新設定或修改設定
            public string Target = "";
            public int Port = 22;
            public int LocalPort = DefaultLocalPort;
            public bool Autostart;
        }

        const string IntroText =
            "適用情境：在這台電腦用 Claude 桌面版，透過 SSH 連到遠端機器開發，並在遠端機器安裝了 AGY Git Graph（含 Claude /git-graph 技能）。\n" +
            "Git Graph 伺服器跑在遠端，Claude 右側的瀏覽器窗格在這台電腦，因此需要由這台電腦建立一條 SSH 通道。";

        const string RiskText =
            "【為什麼需要這條通道】\n" +
            "在 Claude 桌面版用 SSH 連到遠端機器開發時，Git Graph 伺服器跑在遠端，但右側瀏覽器窗格在這台電腦上，必須透過 SSH 通道才連得到。設定成登入時自動啟動後，/git-graph 隨時可直接開啟，不必每次自己連線。\n\n" +
            "【風險與影響】\n" +
            "1. 常駐連線：登入 Windows 後，會用您現有的 SSH 金鑰在背景維持一條到遠端機器的連線；不會另外儲存密碼或新的金鑰。\n" +
            "2. 本機埠：會在這台電腦開一個只接受本機連線的埠（127.0.0.1）。這台電腦上的其他程式或其他已登入的使用者，也能透過它讀取遠端 Git Graph 的內容（倉庫的 commit、diff），並可觸發 fetch 與外掛更新。\n" +
            "3. 背景重試：遠端機器關機或網路不通時，會在背景每 5～60 秒重試一次，只寫入紀錄檔，不會打擾您。\n" +
            "4. 需要金鑰登入：若之後金鑰失效或遠端主機金鑰改變，通道會持續連不上，需要重新設定。\n\n" +
            "可隨時從開始功能表「Git Graph SSH 通道」手動啟動，或重新執行此安裝程式取消自動啟動。\n\n" +
            "確定要設定為登入 Windows 時自動啟動嗎？";

        const string ManualHint =
            "未設定登入時自動啟動：在 Claude 的 SSH 工作階段使用 /git-graph 前，請先從開始功能表執行「Git Graph SSH 通道」。\n\n";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isUninstall = Path.GetFileNameWithoutExtension(AppDomain.CurrentDomain.FriendlyName)
                .IndexOf("uninstall", StringComparison.OrdinalIgnoreCase) >= 0;
            bool isSilent = false;
            TunnelChoice argChoice = new TunnelChoice();
            bool argAutostart = false;
            for (int i = 0; args != null && i < args.Length; i++)
            {
                string a = args[i];
                if (a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase) || a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)) isUninstall = true;
                else if (a.Equals("/s", StringComparison.OrdinalIgnoreCase) || a.Equals("/quiet", StringComparison.OrdinalIgnoreCase) || a.Equals("-y", StringComparison.OrdinalIgnoreCase)) isSilent = true;
                else if (a.Equals("/autostart", StringComparison.OrdinalIgnoreCase)) argAutostart = true;
                else if (a.Equals("/tunnel", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { argChoice.Setup = true; argChoice.Target = args[++i]; }
                else if (a.Equals("/port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) int.TryParse(args[++i], out argChoice.Port);
                else if (a.Equals("/local-port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) int.TryParse(args[++i], out argChoice.LocalPort);
            }

            string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "agy-git-graph", "ssh-tunnel");

            if (isUninstall)
            {
                RunUninstall(installDir, isSilent);
                return;
            }

            // 安裝前先讀取目前狀態：已設定過則沿用（更新時不再詢問），正在執行則先停止、裝完以新版重新啟動
            TunnelState state = ReadTunnelState(installDir);
            TunnelChoice choice;
            if (isSilent)
            {
                choice = new TunnelChoice();
                choice.Autostart = state.Autostart || argAutostart;
                if (argChoice.Setup)
                {
                    bool ownPort = state.Configured && state.Running && argChoice.LocalPort == state.LocalPort;
                    if ((ownPort || !IsLocalPortInUse(argChoice.LocalPort)) && TestSshKeyLogin(argChoice.Target, argChoice.Port))
                    {
                        choice.Setup = true;
                        choice.Target = argChoice.Target;
                        choice.Port = argChoice.Port;
                        choice.LocalPort = argChoice.LocalPort;
                    }
                }
            }
            else if (!ShowOptions(state, out choice))
            {
                return;
            }

            try
            {
                if (state.Running) RunTunnelScript(installDir, "-Stop");
                ExtractPayload(installDir);
                string hint = ApplyTunnel(installDir, state, choice);

                if (!isSilent)
                {
                    MessageBox.Show(
                        "🎉 " + ProductTitle + " 安裝完成！\n\n" +
                        "安裝目錄:\n" + installDir + "\n\n" +
                        hint +
                        "之後在 Claude 的 SSH 工作階段輸入 /git-graph，開啟它提供的網址即可。",
                        ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                if (!isSilent)
                {
                    MessageBox.Show("安裝過程中發生錯誤:\n" + ex.Message, ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        static void RunUninstall(string installDir, bool isSilent)
        {
            if (!isSilent)
            {
                DialogResult confirm = MessageBox.Show(
                    "確定要解除安裝 " + ProductTitle + " 嗎？\n\n會停止通道，並移除登入時自動啟動、開始功能表捷徑與設定。",
                    ProductTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (confirm != DialogResult.Yes) return;
            }
            try
            {
                RunTunnelScript(installDir, "-Uninstall");
                if (Directory.Exists(installDir)) Directory.Delete(installDir, true);
                if (!isSilent)
                {
                    MessageBox.Show(ProductTitle + " 已解除安裝。", ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                if (!isSilent)
                {
                    MessageBox.Show("解除安裝失敗:\n" + ex.Message, ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        // 內嵌的通道腳本與隱藏啟動器
        static void ExtractPayload(string installDir)
        {
            Directory.CreateDirectory(installDir);
            Assembly assembly = Assembly.GetExecutingAssembly();
            foreach (string name in new string[] { "git-graph-tunnel.ps1", "run-hidden.vbs" })
            {
                using (Stream stream = assembly.GetManifestResourceStream(name))
                {
                    if (stream == null) throw new Exception("找不到內嵌檔案: " + name);
                    using (FileStream fs = File.Create(Path.Combine(installDir, name)))
                    {
                        stream.CopyTo(fs);
                    }
                }
            }
        }

        static string ScriptPath(string installDir)
        {
            return Path.Combine(installDir, "git-graph-tunnel.ps1");
        }

        // 執行通道腳本（隱藏視窗），回傳結束代碼；output 為標準輸出
        static int RunTunnelScript(string installDir, string arguments, out string output)
        {
            output = "";
            string script = ScriptPath(installDir);
            if (!File.Exists(script)) return -1;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" " + arguments);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                using (Process p = Process.Start(psi))
                {
                    output = p.StandardOutput.ReadToEnd();
                    if (!p.WaitForExit(60000)) { try { p.Kill(); } catch {} return -1; }
                    return p.ExitCode;
                }
            }
            catch
            {
                return -1;
            }
        }

        static int RunTunnelScript(string installDir, string arguments)
        {
            string ignored;
            return RunTunnelScript(installDir, arguments, out ignored);
        }

        static TunnelState ReadTunnelState(string installDir)
        {
            TunnelState st = new TunnelState();
            string json;
            if (RunTunnelScript(installDir, "-StatusJson", out json) != 0 || string.IsNullOrEmpty(json)) return st;

            st.Configured = Regex.IsMatch(json, "\"configured\"\\s*:\\s*true");
            st.Running = Regex.IsMatch(json, "\"running\"\\s*:\\s*true");
            st.Autostart = Regex.IsMatch(json, "\"autostart\"\\s*:\\s*true");

            MatchCollection targets = Regex.Matches(json, "\"target\"\\s*:\\s*\"([^\"]*)\"");
            MatchCollection ports = Regex.Matches(json, "\"port\"\\s*:\\s*(\\d+)");
            MatchCollection localPorts = Regex.Matches(json, "\"localPort\"\\s*:\\s*(\\d+)");
            if (targets.Count > 0)
            {
                st.Target = targets[0].Groups[1].Value;
                if (ports.Count > 0) st.Port = int.Parse(ports[0].Groups[1].Value);
                if (localPorts.Count > 0) st.LocalPort = int.Parse(localPorts[0].Groups[1].Value);
                string[] list = new string[targets.Count];
                for (int i = 0; i < targets.Count; i++) list[i] = targets[i].Groups[1].Value;
                st.Summary = string.Join("、", list);
            }
            return st;
        }

        // 測試能否以 SSH 金鑰登入（不詢問密碼）
        static bool TestSshKeyLogin(string target, int port)
        {
            try
            {
                string ssh = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", "ssh.exe");
                if (!File.Exists(ssh)) ssh = "ssh";
                string arguments = "-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new " +
                    (port != 22 ? "-p " + port + " " : "") + "\"" + target + "\" exit";
                ProcessStartInfo psi = new ProcessStartInfo(ssh, arguments);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    if (!p.WaitForExit(20000)) { try { p.Kill(); } catch {} return false; }
                    return p.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        // 本機埠是否已被其他程式監聽
        static bool IsLocalPortInUse(int port)
        {
            try
            {
                foreach (IPEndPoint ep in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
                {
                    if (ep.Port == port) return true;
                }
            }
            catch {}
            return false;
        }

        // 依選擇套用通道設定，回傳要顯示在完成訊息中的說明
        static string ApplyTunnel(string installDir, TunnelState before, TunnelChoice choice)
        {
            string hint = "";
            bool configured = before.Configured;

            if (choice.Setup)
            {
                if (before.Configured && !string.IsNullOrEmpty(before.Target) && before.Target != choice.Target)
                {
                    RunTunnelScript(installDir, "-Remove \"" + before.Target + "\"");
                }
                if (RunTunnelScript(installDir, "-Add \"" + choice.Target + "\" -Port " + choice.Port + " -LocalPort " + choice.LocalPort) == 0)
                {
                    configured = true;
                    hint += "遠端機器: " + choice.Target + " -> http://localhost:" + choice.LocalPort + "\n\n";
                }
                else
                {
                    hint += "設定失敗（本機埠可能已被其他程式使用）\n\n";
                }
            }

            if (!configured) return hint;

            RunTunnelScript(installDir, "-InstallShortcut");

            bool autostart = before.Autostart;
            if (choice.Autostart != before.Autostart)
            {
                RunTunnelScript(installDir, choice.Autostart ? "-EnableAutostart" : "-DisableAutostart");
                autostart = choice.Autostart;
                hint += (autostart ? "已設定登入 Windows 時自動啟動" : "已取消登入時自動啟動") + "\n\n";
            }

            // 安裝前正在執行 → 以新版重新啟動；新設定且選擇自動啟動 → 立即啟動
            if (before.Running || (choice.Setup && autostart))
            {
                if (RunTunnelScript(installDir, "-Start") == 0)
                {
                    hint += (before.Running ? "通道已以新版重新啟動" : "通道已啟動") + "\n\n";
                }
            }

            if (!autostart) hint += ManualHint;
            return hint;
        }

        static Label MakeNote(string text, int indent)
        {
            Label l = new Label();
            l.Text = text;
            l.ForeColor = SystemColors.GrayText;
            l.AutoSize = true;
            l.MaximumSize = new Size(480, 0);
            l.Margin = new Padding(indent, 0, 0, 8);
            return l;
        }

        // 選項視窗：回傳 false 表示使用者取消
        static bool ShowOptions(TunnelState state, out TunnelChoice result)
        {
            TunnelChoice choice = new TunnelChoice();
            choice.Autostart = state.Autostart;
            result = choice;

            using (Form form = new Form())
            {
                form.Text = ProductTitle + " 安裝";
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.AutoScaleMode = AutoScaleMode.Font;
                form.Font = SystemFonts.MessageBoxFont;
                form.AutoSize = true;
                form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                form.Padding = new Padding(14);

                FlowLayoutPanel panel = new FlowLayoutPanel();
                panel.FlowDirection = FlowDirection.TopDown;
                panel.AutoSize = true;
                panel.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                panel.WrapContents = false;

                Label intro = new Label();
                intro.Text = IntroText;
                intro.AutoSize = true;
                intro.MaximumSize = new Size(500, 0);
                intro.Margin = new Padding(0, 0, 0, 12);
                panel.Controls.Add(intro);

                CheckBox modifyBox = null;
                if (state.Configured)
                {
                    panel.Controls.Add(MakeNote("目前已設定：" + state.Summary + "；登入時自動啟動：" + (state.Autostart ? "是" : "否") + "\n直接按「安裝」會保留現有設定，只更新程式。", 0));
                    modifyBox = new CheckBox();
                    modifyBox.Text = "修改遠端機器設定";
                    modifyBox.AutoSize = true;
                    panel.Controls.Add(modifyBox);
                }
                else
                {
                    Label head = new Label();
                    head.Text = "遠端機器（這台電腦連過去的方式）：";
                    head.AutoSize = true;
                    panel.Controls.Add(head);
                }

                TableLayoutPanel fields = new TableLayoutPanel();
                fields.ColumnCount = 2;
                fields.AutoSize = true;
                fields.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                fields.Margin = new Padding(20, 4, 0, 4);
                TextBox targetText = new TextBox();
                targetText.Width = 240;
                targetText.Text = state.Configured ? state.Target : "";
                TextBox portText = new TextBox();
                portText.Width = 70;
                portText.Text = state.Port.ToString();
                TextBox localPortText = new TextBox();
                localPortText.Width = 70;
                localPortText.Text = state.LocalPort.ToString();
                string[] captions = new string[] { "SSH 目標（使用者@主機）：", "SSH 埠：", "本機埠：" };
                Control[] inputs = new Control[] { targetText, portText, localPortText };
                for (int i = 0; i < captions.Length; i++)
                {
                    Label cap = new Label();
                    cap.Text = captions[i];
                    cap.AutoSize = true;
                    cap.Anchor = AnchorStyles.Left;
                    fields.Controls.Add(cap, 0, i);
                    fields.Controls.Add(inputs[i], 1, i);
                }
                panel.Controls.Add(fields);
                panel.Controls.Add(MakeNote("需先能在這台電腦以 SSH 金鑰登入遠端機器（不需輸入密碼）；也可填 ~/.ssh/config 中的主機別名。", 20));

                CheckBox autostartBox = new CheckBox();
                autostartBox.Text = "登入 Windows 時自動啟動此通道";
                autostartBox.Checked = state.Autostart;
                autostartBox.AutoSize = true;
                autostartBox.Margin = new Padding(0, 4, 0, 14);
                panel.Controls.Add(autostartBox);

                bool riskConfirmed = state.Autostart; // 已啟用過代表先前已同意，不再詢問
                EventHandler refresh = delegate
                {
                    fields.Enabled = !state.Configured || (modifyBox != null && modifyBox.Checked);
                };
                if (modifyBox != null) modifyBox.CheckedChanged += refresh;
                refresh(null, EventArgs.Empty);
                autostartBox.CheckedChanged += delegate
                {
                    if (autostartBox.Checked && !riskConfirmed)
                    {
                        DialogResult r = MessageBox.Show(form, RiskText, ProductTitle + "：登入時自動啟動", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                        if (r == DialogResult.Yes) riskConfirmed = true;
                        else autostartBox.Checked = false;
                    }
                };

                FlowLayoutPanel buttons = new FlowLayoutPanel();
                buttons.FlowDirection = FlowDirection.RightToLeft;
                buttons.AutoSize = true;
                buttons.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                buttons.Anchor = AnchorStyles.Right;
                Button cancel = new Button();
                cancel.Text = "取消";
                cancel.DialogResult = DialogResult.Cancel;
                cancel.AutoSize = true;
                Button ok = new Button();
                ok.Text = "安裝";
                ok.AutoSize = true;
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(ok);
                panel.Controls.Add(buttons);

                ok.Click += delegate
                {
                    if (fields.Enabled)
                    {
                        string target = targetText.Text.Trim();
                        int port, localPort;
                        if (target.Length == 0 || target.IndexOf(' ') >= 0)
                        {
                            MessageBox.Show(form, "請輸入 SSH 目標，例如 user@192.168.1.10，或您 ~/.ssh/config 中的主機別名。", ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        if (!int.TryParse(portText.Text.Trim(), out port) || port < 1 || port > 65535 ||
                            !int.TryParse(localPortText.Text.Trim(), out localPort) || localPort < 1024 || localPort > 65535)
                        {
                            MessageBox.Show(form, "SSH 埠需為 1～65535，本機埠需為 1024～65535。", ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        bool ownPort = state.Configured && state.Running && localPort == state.LocalPort;
                        if (!ownPort && IsLocalPortInUse(localPort))
                        {
                            MessageBox.Show(form,
                                "本機埠 " + localPort + " 已被其他程式使用（例如您自己建立的 SSH 通道或其他服務）。\n\n" +
                                "若該程式已經提供連到遠端 Git Graph 的通道，就不必再設定；否則請改用其他本機埠（例如 52897）。",
                                ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        Cursor previous = form.Cursor;
                        form.Cursor = Cursors.WaitCursor;
                        ok.Enabled = false;
                        bool keyOk = TestSshKeyLogin(target, port);
                        ok.Enabled = true;
                        form.Cursor = previous;
                        if (!keyOk)
                        {
                            MessageBox.Show(form,
                                "無法用 SSH 金鑰登入 " + target + "。\n\n請先設定好金鑰登入（例如 ssh-keygen 與 ssh-copy-id），並確認可在這台電腦執行：\nssh " + target + "\n且不需要輸入密碼，再重新設定。",
                                ProductTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        choice.Setup = true;
                        choice.Target = target;
                        choice.Port = port;
                        choice.LocalPort = localPort;
                    }
                    choice.Autostart = autostartBox.Checked;
                    form.DialogResult = DialogResult.OK;
                };

                form.Controls.Add(panel);
                form.AcceptButton = ok;
                form.CancelButton = cancel;
                return form.ShowDialog() == DialogResult.OK;
            }
        }
    }
}
