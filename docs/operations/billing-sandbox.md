# Stripe billing sandbox

This flow exercises Opaline's real authenticated Checkout, webhook, seat, and
PostHog paths without moving money. Stripe test objects and live objects are
separate; the API rejects keys, Prices, Checkout Sessions, subscriptions, and
webhooks that do not match `STRIPE_BILLING_MODE`.

Sandbox billing also requires a loopback PostgreSQL connection. Do not use the
hosted development preview for this flow: it shares production data. Run it
against the local Postgres instance from `bun run dev:local` or another local
database.

## 1. Provision the four sandbox Prices

Copy a Stripe sandbox secret key from the Stripe Dashboard, then run:

```bash
STRIPE_SECRET_KEY=sk_test_... bun run --cwd apps/api billing:sandbox:setup
```

The command reuses Prices by lookup key and prints `STRIPE_BILLING_MODE` plus
the four Price IDs. Add those values and the secret key to
`apps/api/.env.local`.

## 2. Install the Stripe CLI

Install the Stripe CLI. The local launcher uses the test secret key directly,
so a separate `stripe login` is not required:

```bash
brew install stripe/stripe-cli/stripe
```

## 3. Run and test

Before creating Checkout Sessions, set these Stripe **Business details → Public
details** URLs in both sandbox and live mode:

- Privacy policy: `https://opaline.so/legal/privacy-policy/`
- Terms of service: `https://opaline.so/legal/terms-of-service/`

Checkout requires explicit Terms acceptance and Stripe rejects Session creation
when the account-level Terms URL is missing.

Start the isolated local billing product:

```bash
bun run dev:billing-sandbox
```

Open `http://localhost:4011/{workspace}/settings/workspace`. Workspace owners
see a **Stripe sandbox** card with Basic and Business monthly/yearly buttons.
Checkout reuses one open Session for the workspace and selection, including
after an interrupted server response. Changing the selection expires the old
Session before creating another. Every Session uses the current teammate count.

For a successful payment, use:

- Card: `4242 4242 4242 4242`
- Expiry: any future date
- CVC: any three digits

The launcher obtains the current Stripe CLI signing secret, applies PostgreSQL
migrations, and starts the webhook forwarder, API, web app, and sandbox billing
worker together. After Stripe returns
to workspace settings, it consumes the signed webhook and updates billing and
PostHog within a few seconds. The Checkout Session and all resulting Stripe
objects are sandbox-only.

To rerun the Checkout idempotency and per-seat integration test directly:

```bash
cd apps/api
bun --env-file=.env.local run test:billing-sandbox
```

After checkout, the owner sees a compact **Billing** section. **Manage
payment** opens a short-lived Stripe Customer Portal session for payment-method
updates, invoices, and cancellation. **Change plan** opens the public pricing
page and then a targeted Portal confirmation that preserves seat quantity. Plan
changes take effect immediately and invoice any proration immediately; Opaline
does not create Subscription Schedules that could conflict with later seat
reconciliation.

Adding or removing a teammate updates the Stripe subscription quantity on the
next billing-worker pass. Seat increases use Stripe pending updates: Opaline
only commits the new quantity after the proration invoice succeeds, and safely
reconciles it after a failure or expiration. The teammate inherits or loses the
workspace's paid PostHog person properties at the same time as the membership
change.

During Stripe's payment-recovery window, a `past_due` workspace keeps its paid
plan identity and access. Stripe's final `unpaid` or `canceled` state removes
paid access; configure that final state deliberately in Stripe's Revenue
Recovery settings.

To verify PostHog delivery too, configure `POSTHOG_ENABLED=true`, `POSTHOG_KEY`,
and `POSTHOG_HOST` in `apps/api/.env.local` before starting
`dev:billing-sandbox`.

## Live-mode checklist

Before enabling live billing:

- Register only the webhook events listed in `apps/api/.env.example`, using API
  version `2026-08-26.dahlia`.
- Set the public Privacy and Terms URLs above before enabling Checkout.
- Enable Stripe Smart Retries and customer emails for failed or
  authentication-required subscription payments.
- Complete Stripe Managed Payments onboarding for the live account. Managed
  Payments is the merchant of record for supported transactions and handles
  indirect tax calculation, collection, filing, and remittance.
- Alert on non-2xx responses from `/api/cron/billing`. The endpoint returns 503
  when `blockedWebhooks`, `blockedAnalytics`, or `pendingSeatCharges` is
  non-zero. Pending deliveries retry with exponential backoff for more than
  three days before blocking.
- After resolving the cause, replay one Stripe event with
  `bun --env-file=.env.local run billing:webhook:requeue -- evt_...` from
  `apps/api`, or replay blocked PostHog deliveries with
  `bun --env-file=.env.local run billing:analytics:requeue`.
- Use restricted production keys where practical, restrict their permissions
  to the Stripe resources Opaline uses, rotate webhook secrets deliberately,
  and never reuse sandbox secrets in live mode.
