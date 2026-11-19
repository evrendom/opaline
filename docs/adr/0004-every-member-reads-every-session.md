# Every member reads every session and setup in the workspace

By default every member of a workspace may read every teammate's sessions and setup, personal setup included (personal instructions, skills, permission settings and auto-memory). Opaline is how a team learns from all of its agent sessions, not a way to check people's performance; a retro across the team needs every teammate's runs and the setup they ran under, and hiding them from members turns the team's sessions back into private ones. Answers still describe setups and patterns and never single out or rank people.

## Considered Options

- Members read their own sessions, admins read all (what the code did): rejected as the default; it makes team learning an admin feature.
- Personal setup stricter than sessions (content shown only to its owner): rejected; a finding that a personal skill shadowed the repository's needs its content to be useful to the team.
- Telling members at connect time that their sessions are visible to the team: not needed; the privacy policy already says access within a workspace follows its settings and permissions.

## Consequences

- "Own sessions only, admins all" stays in the code as a workspace option, switched off and not settable in settings for now.
- `session-detail-access.ts`, `services/analysis/scope.ts`, the MCP tool descriptions and the plugin skill (`plugin/skills/opaline/SKILL.md`), which all say members see only their own sessions, change with this decision.
- The admin is no longer a reading role. ADR 0001's option to restrict a shared analysis's results to admins and the session's owner applies only with the own-sessions-only option on.
