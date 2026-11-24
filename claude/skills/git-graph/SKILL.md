---
name: git-graph
description: Open AGY Git Graph (visual branch graph and commit diff viewer) for the current session's project in the Claude desktop app's built-in browser pane, beside the chat. Works in local sessions and in sessions connected over SSH. Use when the user types /git-graph or asks to open or show the Git Graph, git graph, branch graph, commit graph or commit history view.
---

<!-- managed-by: agy-git-graph — installed and kept up to date by the AGY Git Graph plugin; local edits are overwritten on update. -->

# Git Graph

Open the AGY Git Graph page for **this session's project**. One shared local server serves every session; each session's page shows its own repository through the `?repo=` parameter, so sessions never interfere with each other.

All launcher calls below use this command, where `<dir>` is this session's working directory and `<launcher>` is:

- PowerShell: `node "$env:USERPROFILE\.gemini\config\plugins\agy-git-graph\sidecars\git_graph_server\claude-open.mjs"`
- bash / zsh: `node "$HOME/.gemini/config/plugins/agy-git-graph/sidecars/git_graph_server/claude-open.mjs"`

Each call prints one JSON line.

## 1. Start

Run `<launcher> --repo "<dir>"`. It starts the server only when it is not already running (or is older than the installed version), as a background process that belongs to no session.

- `ok` is `false`: report `error` as-is and stop.
- `mode` is `"local"`: go to **2. Local session**.
- `mode` is `"ssh"`: go to **3. SSH session**.

## 2. Local session

Open `url` in the **Claude desktop built-in browser pane** (the in-app browser beside the chat), not the user's external browser, unless the user asks for that or the built-in browser is unavailable. If a Git Graph tab from this session is already open, navigate it to `url` instead of opening another. Tell the user in one line that Git Graph is open for this project.

## 3. SSH session

This session runs on a remote machine, but the browser pane runs on the user's own computer, so the user needs an SSH tunnel from their computer to this machine. The tunnel settings are saved per remote machine (`hostKey`) and shared by every project and session on it.

1. **If `configured` is `false`** (first time on this machine), ask the user to fill in the tunnel settings before giving any command. Ask in plain text in your message for the user to type the values; do not use a multiple-choice question and do not pre-select or recommend values for them. List the three fields:
   - SSH target: how they reach this machine from their own computer, as `user@host`, or an alias from their own `~/.ssh/config`, or with a jump host they normally use
   - SSH port (usually `22`)
   - Local port on their computer (any free port; `52898` avoids clashing with their own local Git Graph on `52899`)

   Below the fields, add one line with the values detected from this session (`target`, `sshPort`, `localPort` from the JSON) as a reference only, and say they can reply with those values if they are right. Wait for the user's reply; never save values the user has not given.

   Then save the answer: `<launcher> --repo "<dir>" --save-ssh "<target>" --ssh-port <sshPort> --local-port <localPort>`, and use the JSON it prints from here on.

2. Give the user the address to open or refresh in the Claude desktop built-in browser pane: `url`. If the browser tools available to you can open it in that pane, open it yourself; in an SSH session they usually cannot, so the user opens it. Assume the tunnel may already be running (the AGY Git Graph Windows installer can keep it running in the background), so do not ask the user to start anything yet.

3. Confirm the connection: run `<launcher> --repo "<dir>" --wait-connected 90 --since <since>` (`since` from the JSON in step 1 or the save call). It returns as soon as a page for this project talks to the server through the tunnel (an already-open page counts within a few seconds), or after 90 seconds.
   - `connected` is `true`: tell the user Git Graph is connected. Done.
   - `connected` is `false`: no page for this project reached the server. This cannot tell whether the address was not opened or the tunnel is down, so do not claim the tunnel is not running. First ask the user to open (or refresh) `url` in the built-in browser pane, and run step 3 again with a new `since` from a fresh step 1 call.
   - Still `false`, or the user says the page does not load (connection refused / cannot be reached): now the tunnel is likely not running. Tell the user, briefly, how to start it on **their own computer**, then repeat step 3 the same way:
     - **Windows** (the usual case): the tunnel is set up by the separate **AGY Git Graph SSH tunnel installer** (`...-ssh-tunnel-setup.exe`), run on the user's own computer, not on this machine.
       - If they have not installed it yet: give them `tunnelInstallerUrl` and say to download and run the `ssh-tunnel-setup.exe` from the latest release; it asks how to reach this machine (they can use `target`, `sshPort`, `localPort` from the JSON), tests the key login, and can start the tunnel at Windows logon.
       - If it is installed but not running: start it from the Start menu entry **"Git Graph SSH 通道"**.
       - If it is installed but this machine is not in it yet: run `windowsTunnelCommand` once in PowerShell (fenced `powershell` block); it adds this machine and starts the tunnel.
       Ask which case applies only if it is unclear; it reconnects by itself afterwards.
     - **Other systems**: run `sshCommand` (fenced `bash` block) and keep it open; it serves every project on this machine.
     - If it still fails, ask whether the settings are right and offer to change them: save new values with `--save-ssh` as in step 1, then repeat.

When `configured` is `true`, skip step 1 entirely: give the address (step 2), then confirm (step 3). Only ask about settings again if the connection keeps failing.

## When something fails

- The launcher file does not exist: AGY Git Graph is not installed on this machine (in an SSH session: on the remote machine). Point the user to https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases (the setup installer adds both AGY and this Claude skill).
- `node` is not found: Node.js is required; ask the user to install it.

## Rules

- Never stop or kill the Git Graph server: other sessions may be using it. The page's own update button restarts it to the new version automatically.
- Never make the server listen on anything but `127.0.0.1`; over SSH, use the tunnel.
- Do not edit files under `~/.gemini/config/plugins/agy-git-graph/`; they belong to the installed plugin. Change tunnel settings only through `--save-ssh`.
