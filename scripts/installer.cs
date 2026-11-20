using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using System.Diagnostics;

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

            // 安裝流程
            try
            {
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

                if (!isSilent)
                {
                    DialogResult res = MessageBox.Show(
                        "🎉 AGY Git Graph 外掛已成功安裝！\n\n" +
                        "安裝目錄:\n" + targetDir + "\n\n" +
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
