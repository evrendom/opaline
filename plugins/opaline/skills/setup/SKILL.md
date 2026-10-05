---
name: setup
description: "Set up Opaline right after the plugin is installed. Check that the workspace has uploaded sessions and, if not, point the user to opaline.so to connect their coding agents."
---

# Set up Opaline

Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI).

Use only `list_workspaces` here. It reads no session content and saves nothing.

1. Call `list_workspaces`. Each workspace has `sessionsLast365Days`: the sessions you can see from the last 365 days (workspace admins see the whole team's, members their own). The entry with `default: true` is the workspace Opaline answers from; name it. If the user belongs to more than one workspace, say they can change it under **Default workspace** in the plugin settings.
2. Look at the default workspace's `sessionsLast365Days`.
   - Above 0: say Opaline is ready and suggest two team questions, such as "Where did our agents get stuck or waste the most time this month?" or "What mistakes keep coming back in our agent runs?". The Opaline dashboard is also in the sidebar.
   - 0: say there are no sessions you can see yet. Tell the user to open https://opaline.so, sign in and follow the steps there to connect their coding agents. Each teammate connects their own, so team questions get better as more of the team joins. Don't run any commands for them. Once they're done, check again with `list_workspaces`.
