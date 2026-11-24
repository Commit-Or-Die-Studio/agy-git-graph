---
name: git-graph
description: Open AGY Git Graph (visual branch graph and commit diff viewer) for the current session's project in the Claude desktop app's built-in browser pane, beside the chat. Use when the user types /git-graph or asks to open or show the Git Graph, git graph, branch graph, commit graph or commit history view.
---

<!-- managed-by: agy-git-graph — installed and kept up to date by the AGY Git Graph plugin; local edits are overwritten on update. -->

# Git Graph

Open the AGY Git Graph page for **this session's project** in the built-in browser pane. One shared local server serves every session; each session's pane shows its own repository through the `?repo=` parameter, so sessions never interfere with each other.

## Steps

1. Run the launcher with Node.js, passing this session's working directory as `--repo` (one command; it returns within about 15 seconds):
   - PowerShell: `node "$env:USERPROFILE\.gemini\config\plugins\agy-git-graph\sidecars\git_graph_server\claude-open.mjs" --repo "<session working directory>"`
   - bash / zsh: `node "$HOME/.gemini/config/plugins/agy-git-graph/sidecars/git_graph_server/claude-open.mjs" --repo "<session working directory>"`

   It prints one JSON line, for example `{"ok":true,"url":"http://localhost:52899/?repo=...","version":"1.0.10","reused":true}`. The launcher starts the server only when it is not already running (or is an older version), as a background process that does not belong to any session.

2. If `ok` is `true`, open `url` in the **Claude desktop built-in browser pane** (the in-app browser beside the chat), not the user's external browser, unless the user asks for that or the built-in browser is unavailable. If a Git Graph tab from this session is already open, navigate it to `url` instead of opening another.

3. Tell the user in one line that Git Graph is open for this project.

## When something fails

- The launcher file does not exist: AGY Git Graph is not installed on this machine. Point the user to https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases (the setup installer adds both AGY and this Claude skill).
- `node` is not found: Node.js is required; ask the user to install it.
- `ok` is `false`: report the `error` text as-is.

## Rules

- Never stop or kill the Git Graph server: other sessions may be using it. The page's own update button restarts it to the new version automatically.
- Do not edit files under `~/.gemini/config/plugins/agy-git-graph/`; they belong to the installed plugin.
