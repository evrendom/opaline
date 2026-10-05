---
name: setup
description: Set up Opaline right after the plugin is installed — check that the workspace has uploaded sessions and, if not, point the user to opaline.so to connect their coding agents.
---

# Set up Opaline

1. Call `list_workspaces`. If the user belongs to more than one workspace, tell them which one Opaline will answer from and that they can change it under **Default workspace** in the plugin settings.
2. Call `list_sessions` with `days: 365` and `limit: 1`.
   - If it returns a session, say Opaline is ready and suggest two team questions, such as "Where did our agents waste the most time this month?" or "What mistakes keep coming back across the team?". The Opaline dashboard is also in the sidebar.
   - If it returns nothing, tell the user to open https://opaline.so, sign in and follow the steps there to connect their coding agents. Each teammate connects their own, so team questions get better as more of the team joins. Don't run any commands for them. Once they're done, check again with `list_sessions`.
