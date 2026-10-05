---
name: setup
description: Set up Opaline right after the plugin is installed. Check that the workspace has uploaded sessions and, if not, point the user to opaline.so to connect their coding agents.
---

# Set up Opaline

Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI).

1. Call `list_workspaces`. If the user belongs to more than one workspace, tell them which one Opaline will answer from and that they can change it under **Default workspace** in the plugin settings.
2. Call `find` with `source: "runs"`, `from` = the date one year ago (YYYY-MM-DD, UTC), `latest: 1` and `question: "Is Opaline set up?"`. The host may ask the user once to allow it; they can choose "always allow". The call is kept in a private draft that nobody can see and that is deleted after 7 days; nothing needs saving here.
   - If the header shows at least one session in scope, say Opaline is ready and suggest two team questions, such as "Where did our agents get stuck or waste the most time this month?" or "What mistakes keep coming back in our agent runs?". The Opaline dashboard is also in the sidebar.
   - If it shows no sessions, tell the user to open https://opaline.so, sign in and follow the steps there to connect their coding agents. Each teammate connects their own, so team questions get better as more of the team joins. Don't run any commands for them. Once they're done, check again with the same `find` call.
