using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using System.Diagnostics;
using System.Drawing;
using System.Net;

namespace AgyGitGraphInstaller
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isUninstall = false;
            bool isSilent = false;
            bool argClaude = false;
            string exeName = Path.GetFileNameWithoutExtension(AppDomain.CurrentDomain.FriendlyName);
            if (exeName.IndexOf("uninstall", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                isUninstall = true;
            }

            if (args != null)
            {
                foreach (string arg in args)
                {
                    if (arg.Equals("/uninstall", StringComparison.OrdinalIgnoreCase) || 
                        arg.Equals("-u", StringComparison.OrdinalIgnoreCase) ||
                        arg.Equals("--uninstall", StringComparison.OrdinalIgnoreCase))
                        isUninstall = true;
                    if (arg.Equals("/claude", StringComparison.OrdinalIgnoreCase) ||
                        arg.Equals("--claude", StringComparison.OrdinalIgnoreCase))
                        argClaude = true;
                    if (arg.Equals("/s", StringComparison.OrdinalIgnoreCase) || 
                        arg.Equals("/quiet", StringComparison.OrdinalIgnoreCase) ||
                        arg.Equals("-y", StringComparison.OrdinalIgnoreCase))
                        isSilent = true;
                }
            }

            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string targetDir = Path.Combine(userProfile, ".gemini", "config", "plugins", "agy-git-graph");

            if (isUninstall)
            {
                if (!isSilent)
                {
                    DialogResult confirm = MessageBox.Show(
                        "確定要從您的系統中解除安裝 AGY Git Graph 外掛嗎？\n\n目標目錄:\n" + targetDir,
                        "AGY Git Graph 解除安裝確認",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question
                    );
                    if (confirm != DialogResult.Yes) return;
                }

                try
                {
                    KillRunningSidecars();
                    if (Directory.Exists(targetDir))
                    {
                        Directory.Delete(targetDir, true);
                    }
                    RemoveClaudeSkill(userProfile);
                    if (!isSilent)
                    {
                        MessageBox.Show("AGY Git Graph 已成功解除安裝！\n請重新啟動 Antigravity 應用程式以套用變更。", "解除安裝成功", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                }
                catch (Exception ex)
                {
                    if (!isSilent)
                    {
                        MessageBox.Show("解除安裝失敗，若 Antigravity 正在執行中，請先關閉 Antigravity 應用程式後再重試一次。\n\n詳細錯誤訊息: " + ex.Message, "錯誤", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
                return;
            }

            // 安裝選項：AGY 固定安裝；Claude 功能為選用（新安裝預設不勾，已安裝過則維持目前狀態）
            string claudeDir = GetClaudeConfigDir(userProfile);
            bool claudeAvailable = Directory.Exists(claudeDir);
            bool claudeInstalled = IsClaudeSkillInstalled(userProfile);
            // 靜默安裝：未指定 /claude 時沿用目前狀態（已安裝則保留更新，不會被移除）
            bool wantClaude = argClaude || (isSilent && claudeInstalled);
            if (!isSilent)
            {
                if (!ShowInstallOptions(targetDir, claudeDir, claudeAvailable, claudeInstalled, out wantClaude)) return;
            }

            // 安裝流程
            try
            {
                // Claude 用的獨立伺服器（非 AGY 管理）若正在執行，安裝完成後以新版重新啟動，避免 Claude 窗格中斷
                bool restartClaudeServer = IsStandaloneServerRunning();
                KillRunningSidecars();

                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }

                Assembly assembly = Assembly.GetExecutingAssembly();
                using (Stream stream = assembly.GetManifestResourceStream("payload.zip"))
                {
                    if (stream == null)
                    {
                        throw new Exception("找不到內嵌安裝資料 (payload.zip)");
                    }

                    using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                    {
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string relPath = entry.FullName;
                            if (relPath.StartsWith("agy-git-graph/", StringComparison.OrdinalIgnoreCase))
                            {
                                relPath = relPath.Substring("agy-git-graph/".Length);
                            }
                            if (string.IsNullOrEmpty(relPath)) continue;

                            string destPath = Path.Combine(targetDir, relPath.Replace('/', Path.DirectorySeparatorChar));

                            if (entry.FullName.EndsWith("/"))
                            {
                                if (!Directory.Exists(destPath))
                                {
                                    Directory.CreateDirectory(destPath);
                                }
                            }
                            else
                            {
                                string parent = Path.GetDirectoryName(destPath);
                                if (!Directory.Exists(parent))
                                {
                                    Directory.CreateDirectory(parent);
                                }
                                entry.ExtractToFile(destPath, true);
                            }
                        }
                    }
                }

                string claudeHint = "";
                if (wantClaude)
                {
                    string claudeSkillPath = InstallClaudeSkill(userProfile, targetDir);
                    claudeHint = string.IsNullOrEmpty(claudeSkillPath)
                        ? "Claude 桌面版: 未偵測到 Claude，未安裝 /git-graph 技能\n\n"
                        : "Claude 桌面版: 已安裝 /git-graph 技能\n" + claudeSkillPath + "\n\n";
                }
                else if (claudeInstalled)
                {
                    RemoveClaudeSkill(userProfile);
                    claudeHint = "Claude 桌面版: 已移除 /git-graph 技能\n\n";
                }

                if (restartClaudeServer && StartStandaloneServer(targetDir))
                {
                    claudeHint += "Claude 桌面版: Git Graph 伺服器已以新版重新啟動\n\n";
                }

                if (!isSilent)
                {
                    DialogResult res = MessageBox.Show(
                        "🎉 AGY Git Graph 外掛已成功安裝！\n\n" +
                        "安裝目錄:\n" + targetDir + "\n\n" +
                        claudeHint +
                        "請重新開啟 Antigravity 應用程式，即可於右側輔助面板使用。\n\n" +
                        "是否要在檔案總管開啟安裝目錄？",
                        "AGY Git Graph 安裝成功",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Information
                    );

                    if (res == DialogResult.Yes)
                    {
                        Process.Start("explorer.exe", targetDir);
                    }
                }
            }
            catch (Exception ex)
            {
                if (!isSilent)
                {
                    MessageBox.Show("安裝過程中發生錯誤:\n" + ex.Message, "安裝失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        // Claude Code 設定目錄（尊重 CLAUDE_CONFIG_DIR）
        static string GetClaudeConfigDir(string userProfile)
        {
            string custom = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            return string.IsNullOrEmpty(custom) ? Path.Combine(userProfile, ".claude") : custom;
        }

        const string ClaudeSkillMarker = "managed-by: agy-git-graph";

        // 安裝 Claude 的 /git-graph 技能：僅在已安裝 Claude（設定目錄存在）時寫入，
        // 不覆寫使用者自己建立、未帶本外掛標記的同名技能。回傳寫入路徑，未寫入則回傳空字串。
        static string InstallClaudeSkill(string userProfile, string pluginDir)
        {
            try
            {
                string claudeDir = GetClaudeConfigDir(userProfile);
                string src = Path.Combine(pluginDir, "claude", "skills", "git-graph", "SKILL.md");
                if (!Directory.Exists(claudeDir) || !File.Exists(src)) return "";

                string destDir = Path.Combine(claudeDir, "skills", "git-graph");
                string dest = Path.Combine(destDir, "SKILL.md");
                if (File.Exists(dest) && File.ReadAllText(dest).IndexOf(ClaudeSkillMarker, StringComparison.Ordinal) < 0) return "";

                Directory.CreateDirectory(destDir);
                File.Copy(src, dest, true);
                return dest;
            }
            catch
            {
                return "";
            }
        }

        const int ClaudeServerPort = 52899;

        // 檢查 Claude 用的獨立 Git Graph 伺服器是否正在執行（/api/health 回報 agyManaged:false）
        static bool IsStandaloneServerRunning()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + ClaudeServerPort + "/api/health");
                req.Timeout = 1500;
                req.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    return body.IndexOf("\"name\":\"agy-git-graph\"", StringComparison.Ordinal) >= 0 &&
                           body.IndexOf("\"agyManaged\":false", StringComparison.Ordinal) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        // 以隱藏視窗啟動新版獨立伺服器（安裝程式結束後仍持續執行）；找不到 node 時略過
        static bool StartStandaloneServer(string pluginDir)
        {
            try
            {
                string serverDir = Path.Combine(pluginDir, "sidecars", "git_graph_server");
                string serverPath = Path.Combine(serverDir, "server.mjs");
                if (!File.Exists(serverPath)) return false;

                ProcessStartInfo psi = new ProcessStartInfo("node", "\"" + serverPath + "\" --port " + ClaudeServerPort);
                psi.WorkingDirectory = serverDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                if (psi.EnvironmentVariables.ContainsKey("ANTIGRAVITY_SIDECAR_WEB_PORT")) psi.EnvironmentVariables.Remove("ANTIGRAVITY_SIDECAR_WEB_PORT");
                if (psi.EnvironmentVariables.ContainsKey("PORT")) psi.EnvironmentVariables.Remove("PORT");
                Process.Start(psi);
                return true;
            }
            catch
            {
                return false;
            }
        }

        static bool IsClaudeSkillInstalled(string userProfile)
        {
            try
            {
                string dest = Path.Combine(GetClaudeConfigDir(userProfile), "skills", "git-graph", "SKILL.md");
                return File.Exists(dest) && File.ReadAllText(dest).IndexOf(ClaudeSkillMarker, StringComparison.Ordinal) >= 0;
            }
            catch
            {
                return false;
            }
        }

        // 安裝選項視窗：回傳 false 表示使用者取消
        static bool ShowInstallOptions(string targetDir, string claudeDir, bool claudeAvailable, bool claudeInstalled, out bool wantClaude)
        {
            wantClaude = false;
            using (Form form = new Form())
            {
                form.Text = "AGY Git Graph 安裝";
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

                Label title = new Label();
                title.Text = "請選擇要安裝的項目：";
                title.AutoSize = true;
                title.Margin = new Padding(0, 0, 0, 10);
                panel.Controls.Add(title);

                CheckBox agyBox = new CheckBox();
                agyBox.Text = "AGY Git Graph（必要，固定安裝）";
                agyBox.Checked = true;
                agyBox.Enabled = false;
                agyBox.AutoSize = true;
                panel.Controls.Add(agyBox);

                Label agyNote = new Label();
                agyNote.Text = targetDir;
                agyNote.ForeColor = SystemColors.GrayText;
                agyNote.AutoSize = true;
                agyNote.Margin = new Padding(20, 0, 0, 10);
                panel.Controls.Add(agyNote);

                CheckBox claudeBox = new CheckBox();
                claudeBox.Text = "Claude 桌面版 /git-graph 技能（選用）";
                claudeBox.Checked = claudeAvailable && claudeInstalled;
                claudeBox.Enabled = claudeAvailable;
                claudeBox.AutoSize = true;
                panel.Controls.Add(claudeBox);

                Label claudeNote = new Label();
                claudeNote.Text = claudeAvailable
                    ? "在 Claude 桌面版輸入 /git-graph，於右側開啟目前專案的 Git Graph\n安裝至 " + Path.Combine(claudeDir, "skills", "git-graph")
                    : "未偵測到 Claude（" + claudeDir + "），無法安裝";
                claudeNote.ForeColor = SystemColors.GrayText;
                claudeNote.AutoSize = true;
                claudeNote.Margin = new Padding(20, 0, 0, 14);
                panel.Controls.Add(claudeNote);

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
                ok.DialogResult = DialogResult.OK;
                ok.AutoSize = true;
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(ok);
                panel.Controls.Add(buttons);

                form.Controls.Add(panel);
                form.AcceptButton = ok;
                form.CancelButton = cancel;

                if (form.ShowDialog() != DialogResult.OK) return false;
                wantClaude = claudeBox.Enabled && claudeBox.Checked;
                return true;
            }
        }

        static void RemoveClaudeSkill(string userProfile)
        {
            try
            {
                string destDir = Path.Combine(GetClaudeConfigDir(userProfile), "skills", "git-graph");
                string dest = Path.Combine(destDir, "SKILL.md");
                if (File.Exists(dest) && File.ReadAllText(dest).IndexOf(ClaudeSkillMarker, StringComparison.Ordinal) >= 0)
                {
                    Directory.Delete(destDir, true);
                }
            }
            catch {}
        }

        static void KillRunningSidecars()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*git_graph_server*' -or $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process p = Process.Start(psi);
                p.WaitForExit(3000);
            }
            catch {}
        }
    }
}
