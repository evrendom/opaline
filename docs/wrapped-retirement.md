# Wrapped retirement

Wrapped is retired. The web flow, public sharing and social image generation, desktop resume emails, Decimal claims, RPC contracts, campaign telemetry, and dedicated QA tools have been removed.

New users continue at `/welcome`. Legacy `/get-started` URLs redirect there with their query parameters preserved. Existing CLI pairing and browser-approved workspace binding remain intact. Returning users use `/{workspace}/sessions`.

The API returns HTTP 410 for retired Wrapped, resume, and RPC paths. Team invitation previews retain their own Vercel function and Fly fallback. Public client-source resolution remains shared with CLI pairing.

Unused dashboard widgets, legacy UI primitives, setup polling, team demo data and portraits, and their exclusive dependencies were also removed. Current session, settings, skills, and team functionality remains.

Historical SQL schemas and migrations remain so existing installations can retain their data. The ClickHouse archetype pipeline is retired as well; its tables stay until they are dropped. Wrapped can be recovered from Git history if explicitly requested; it is not a current product specification.
