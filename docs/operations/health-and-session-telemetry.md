# Database monitoring and session loading

## Uptime monitor

Point the existing HTTP monitor at `https://opaline.so/health/ready`, using GET or HEAD and requiring HTTP 200. This endpoint is public and returns no credentials or provider errors.

- 200: Postgres and ClickHouse both acknowledged a committed storage write and read back the newly generated probe ID.
- 503: at least one dependency failed or timed out. The JSON body identifies which dependency and reports probe duration in milliseconds.
- `clickhouse_read` (a read of the probe table) and `clickhouse_ping` (`ping({ select: true })`) are reported but do not decide the status. When `clickhouse` is unavailable they tell a storage write failure apart from an unreachable server.
- `dependencies.clickhouse.outcome` says how the write probe ended:
  - `ok`: the insert was acknowledged and the first read returned the probe ID.
  - `delayed_visibility`: the insert was acknowledged, the first read came back empty and a later read returned the ID. Ready, but reported.
  - `not_visible`: the insert was acknowledged and every read succeeded without the ID. Never ready: a missing row is not a successful read-after-write.
  - `read_failed`: the insert was acknowledged and a read failed. Not retried.
  - `insert_timeout`: ClickHouse answered `TIMEOUT_EXCEEDED` (or a related timeout code), or the client deadline passed first.
  - `insert_failed`: any other insert error, such as denied privileges or a refused connection.
- `dependencies.clickhouse.probe` records the probe ID, the insert's and each read's query ID (`health-write-<probe>`, `health-read-<probe>-<attempt>`, matching `system.query_log.query_id`), start times, durations, `failure` (`clickhouse`, `timeout` or `network`) and the ClickHouse exception code, plus `slow_insert` (an acknowledged insert over 3 seconds) and `visible_after_ms` (from the insert's acknowledgement to the read that returned the ID). Error messages are never returned. The same report is logged once per probe (`rudel.api.health`; info when `ok`, warning when ready with an alert, error otherwise).
- `alerts` lists each class of problem in this result, separately:
  - `availability`: Postgres unavailable, the independent read unavailable, `insert_failed` or `read_failed`.
  - `slow_write`: `insert_timeout`, or an acknowledged insert that took more than 3 seconds.
  - `visibility`: `delayed_visibility` or `not_visible`.
- Deadlines: Postgres, the read and the ping have 3 seconds. The write probe's insert has a 10-second server budget (`max_execution_time` and `wait_for_async_insert_timeout`, since `max_execution_time` alone does not stop the wait for an async insert flush; production logged waits of up to 50 seconds that way) and a 12-second client deadline, so ClickHouse can return its own timeout. The read-back has 2 seconds per read on the server and 3 on the client; only an empty read is retried, after 250, 500 and 1,000 ms, and no retry starts more than 4 seconds after the acknowledgement. A probe therefore takes at most about 19 seconds. Checks run concurrently, overlapping requests share the check, and results are cached in process for 30 seconds. HTTP responses use `Cache-Control: no-store`.
- Expected readiness 503s bypass the Vercel wrapper's exception reporting, avoiding one Sentry event and telemetry flush per failed probe. Unexpected handler exceptions still report.
- Keep `/health` for process liveness. It deliberately does not check databases.

Use a monitor timeout above the probe deadline (30 seconds), a one-minute interval, and recovery notifications on the existing notification destination. To page on sustained incidents rather than single slow requests, set up one monitor per alert class on the same URL, each alerting only after consecutive failures. Match the alert names with their quotes; nothing else in the body contains them:

| Monitor | Fails when | Alert after |
| --- | --- | --- |
| Availability | the response is not 200, or the body contains `"availability"` | 2 consecutive failures |
| Slow writes | the body contains `"slow_write"` | 3 consecutive failures |
| Visibility | the body contains `"visibility"` | 3 consecutive failures |

A 503 from `insert_timeout` or `not_visible` also fails the availability monitor's status check; its body tells which class it was. Regular queries may keep a database with automatic suspension awake.

Deploy the endpoint before changing the monitor. Verify the JSON readiness response in production (200 for successful storage probes, 503 during an outage), then use the monitoring service's notification test to verify delivery. Adding this route alone does not configure the external monitor or enable live alerts.

The probes use the application credentials and dedicated operational tables, never user sessions. Postgres inserts a random UUID into `dependency_health_probe`, commits it with synchronous commit enabled, reads it, and deletes it; subsequent probes also remove leftovers older than one day. ClickHouse inserts a random UUID into `rudel.dependency_health_probes` using `async_insert=1, wait_for_async_insert=1`, then reads that UUID with query caching disabled and `select_sequential_consistency=1`, retrying only empty reads as above. This table uses the session tables’ MergeTree family and `s3` storage policy, with a one-day TTL. Each deadline covers the complete write/read operation, not each query separately. Per-process caching and request coalescing limit probe writes; there is no global rate limit across Vercel instances.

`SELECT 1` is deliberately insufficient: the query frontend can answer while persistent inserts hang. Missing probe tables, denied writes, denied reads, read-backs that never return the probe ID and timeouts all return 503. There is no connectivity-only fallback. A successful canary establishes this small storage operation works; it does not prove every session table, materialized view or business query works.

Before deploying this version, apply the additive schemas with `bun run --cwd packages/sql-schema migrate` and `bun run --cwd packages/ch-schema ch:migrate:dependency-health`, using the deployment’s database configuration. Grant the API identity SELECT/INSERT/DELETE on the Postgres probe table and SELECT/INSERT on the ClickHouse probe table. DDL privileges are only needed by the migration identity. The endpoint never creates tables. A missing migration fails closed rather than reporting healthy.

Verification: real-database regression cases cover a successful `SELECT 1` with ClickHouse INSERT denied, SELECT denied, and Postgres in read-only mode, as well as healthy storage, unavailable databases and stalled TCP connections. ClickHouse permission recovery returns readiness to 200. The new probe was also run against the live configured backend during the insert outage and returned 503 with ClickHouse unavailable.

## Deploying during a known database outage

The Vercel workflow normally requires the database-backed demo sessions request to succeed before promotion. During a known outage, set the GitHub repository variable `SKIP_DATABASE_SMOKE_CHECK` to `true` to bypass only that request:

```sh
gh variable set SKIP_DATABASE_SMOKE_CHECK --repo opalinehq/athena --body true
```

The workflow emits a warning and records the bypass in its summary. Builds, CI tests against disposable databases, `/health`, `/rpc/health`, and the web shell checks remain required. This flag does not change `/health/ready` or uptime alerts. It applies to both preview and production deployments and permits promotion while database-backed features are unavailable.

After database recovery, restore the mandatory demo check:

```sh
gh variable delete SKIP_DATABASE_SMOKE_CHECK --repo opalinehq/athena
```

With the variable absent or any value other than `true`, the demo check runs normally.

## Session timing in PostHog

A completed session open reuses **Dashboard Viewed** with `page_name = session_detail`. There is no new success event, per-render event, or custom pageview/click event. The component reports once per mounted session view; background refetches and date filter changes do not generate additional opens. A different session ID remounts the view.

| Property | Meaning |
| --- | --- |
| `session_id` | The opened session |
| `load_duration_ms` | Time until initial detail has committed and received a paint opportunity |
| `request_duration_ms` | Initial request including network, server work and oRPC decoding; null for cached opens |
| `response_processing_duration_ms` | Additional client validation and overview parsing; null for cached opens |
| `cache_hit` | Initial detail was already in the query cache at mount, including stale cached data |
| `load_start_source` | `navigation` for a normal in-app row click or next/previous action; `mount` for a direct open or other navigation |
| `load_milestone` | `initial_detail_rendered` |
| `was_backgrounded` | Browser tab was hidden during the measured open |
| `turn_count` | Total session turns, for comparing session sizes |

The navigation timer excludes modified/new-tab clicks and clicks on the active session. A mount-based measurement starts when the detail component mounts, so it excludes earlier document loading/authentication. Neither measurement means all transcript pages have loaded. Request duration is not database execution time. If the query retries, total load time includes retries and backoff; request duration describes the successful final request.

For trends, filter `Dashboard Viewed` to `environment = production`, `page_name = session_detail`, `load_milestone = initial_detail_rendered`, and `was_backgrounded = false`. Plot median and p95 of `load_duration_ms` over time. Compare `cache_hit` and `load_start_source` separately. Use `request_duration_ms` to distinguish request delays from time outside the request. Historical events have no timing properties and cannot be backfilled accurately.

**Dashboard Load Failed** now fires for an initial session query failure, with `session_id`, `load_duration_ms`, cache/background/start properties and `load_milestone = initial_error_rendered`. It uses the browser PostHog client directly rather than the database-authenticated analytics RPC. A failure is reported once; it does not also emit Dashboard Viewed. It still requires the loaded user's organization and user IDs, so Uptime Bot is the independent signal for a full outage that prevents authentication or application startup. Navigations abandoned before a result are not counted as completed loads.

## Event audit decisions

- Removed the unused **Dashboard Navigation Clicked**, **Chart Export Triggered**, and **UI Utility Used** schemas, capture functions and hook wrappers. They had no production call sites in this checkout.
- Connected the existing **Dashboard Load Failed** event to actual session-query failures; its old hook wrapper had no callers.
- Retained automatic `$pageview`, errors and web vitals. The SDK explicitly disables generic click autocapture and session replay even if the PostHog project allows them. This change does not alter capture settings.
- Retained **Dashboard Drilldown Opened** and **Dashboard Filter Changed**: they measure user intent and selected filters; a successful session view measures completed loading.
- Retained account, organization and CLI lifecycle events with real call sites. A missing recent event alone does not establish a broken emitter.
- **Session Upload Completed** has a specific coverage gap: this checkout's bundled CLI/adapters supply `upload_mode` but omit `client_surface`, `cli_version` and `platform_os`. The server intentionally declines to emit without all four fields. Existing external clients supplying them can still emit. This change does not add per-upload traffic or alter CLI onboarding.
- CLI capture also requires `POSTHOG_ENABLED=true`, `POSTHOG_KEY` and `POSTHOG_HOST` in the CLI environment. An ordinary install without those settings does not report CLI lifecycle events. No telemetry defaults were changed.
- Historical Wrapped and CLI command events remain in PostHog history. No historical event data was deleted and retired features were not restored.
