# Production on Vercel: storage lifecycle and crons

What the hosted Opaline (Vercel, Cloudflare R2) needs besides the code. A self-hosted server runs
its jobs and the object store sweep itself; see [self-hosting](../self-hosting.md).

## Direct-to-R2 Ingest Lifecycle Backstop

When direct-to-R2 ingest is enabled, configure an object lifecycle rule on the
ingest bucket with the prefix `ingest/` and a seven-day object expiration. The
application job sweeper and terminal-state cleanup are the primary deletion
mechanisms; this lifecycle rule is defense in depth for completed objects that
survive an application or database outage. Cloudflare's default seven-day rule
only aborts incomplete multipart uploads and does not delete completed objects.

In the Cloudflare dashboard, open the bucket's **Settings** page and add an
enabled Object Lifecycle Rule with these values:

- Rule name: `expire-abandoned-ingest-objects`
- Prefix: `ingest/`
- Delete objects after: `7 days`

Verify the rule after provisioning with:

```bash
npx wrangler r2 bucket lifecycle list <bucket-name>
```

## Vercel Hobby and the frequent crons

`vercel.json` schedules `/api/cron/r2-ingest` every minute, so ingest jobs that were left pending during a ClickHouse outage are picked up again within minutes. It also runs `/api/cron/github-evidence` every five minutes: Vercel has no resident worker, so pending GitHub evidence collections and the repository history sweep only advance when this cron runs (up to about four minutes per run; an idle run returns immediately). `/api/cron/l1-edges` runs every minute and builds the L1 edges between sessions, pull requests and CI runs when `L1_EDGES_WORKER_ENABLED=true` (otherwise it returns immediately and requests stay queued). `/api/cron/run-index-heal` runs every five minutes and queues run index rebuilds for sessions whose run index is stale (`RUN_INDEX_HEAL_ENABLED=false` turns it off; it does nothing while the L1 worker is off). `/api/cron/run-questions` runs every minute and answers queued run questions when a provider is configured (`SUBQ_API_KEY`; otherwise it returns immediately). Vercel Hobby only allows daily cron jobs and rejects deployments with more frequent schedules. On Hobby, remove the `/api/cron/r2-ingest` entry and change `/api/cron/github-evidence`, `/api/cron/l1-edges`, `/api/cron/run-index-heal` and `/api/cron/run-questions` to a daily schedule. The daily `/api/cron/repair` job still re-picks pending ingest jobs, and the initial GitHub history then takes much longer to complete.
