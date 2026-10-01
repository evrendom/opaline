---
name: setup
description: Set up Opaline right after the plugin is installed — check that the account has uploaded sessions and, if not, get the user's Claude Code and Codex sessions uploading.
---

# Set up Opaline

1. Call `list_workspaces`. If the user belongs to more than one workspace, tell them which one Opaline will answer from and that they can change it under **Default workspace** in the plugin settings.
2. Call `list_sessions` with `days: 365` and `limit: 1`.
   - If it returns a session, say Opaline is ready and suggest two questions they can ask, such as "What did our agents cost this month?" or "Have we hit this error before?". The Opaline dashboard is also in the sidebar.
   - If it returns nothing, ask them to run this in a terminal on the machine where they use Claude Code or Codex. It is interactive, so do not run it yourself:

     ```bash
     npx opaline@latest
     ```

     It signs them in through the browser, uploads existing sessions for the repositories they pick, and keeps future sessions in sync. Once it finishes, check again with `list_sessions`.
