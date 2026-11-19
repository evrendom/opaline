---
name: setup
description: "Set up Opaline right after the plugin is installed. Check that the Opaline app on this Mac has imported sessions and, if not, point the user to the Opaline app to connect their coding agents."
---

# Set up Opaline

Opaline analyses the Claude Code and Codex sessions on this Mac: where the agents get stuck or waste time and money, and what to fix in the setup (instructions, docs, scripts, hooks, CI). The Opaline app imports the sessions and runs the analysis here. Nothing leaves this Mac.

Use only `list_workspaces` here. It reads no session content and saves nothing.

1. Call `list_workspaces`. When the tool is missing or cannot connect, the Opaline server on this Mac is not running: ask the user to open the Opaline app, then call it again.
2. Look at `sessionsLast365Days`.
   - Above 0: say Opaline is ready and suggest two questions, such as "Where did my agents get stuck or waste the most time this week?" or "Compare my Claude Code and Codex runs this month". They can also ask to see the Opaline dashboard.
   - 0: say no sessions have been imported yet. Tell the user to open the Opaline app and connect their agents there; it imports the sessions already on this Mac. Don't run any commands for them. Once they're done, check again with `list_workspaces`.
