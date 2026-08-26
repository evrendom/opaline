# Vercel WAF rules for anonymous Wrapped shares

The anonymous Wrapped surfaces use best-effort edge protection. Do not add a
database, Redis, SDK, or application middleware for these routes. The existing
in-process limiter remains a backstop; the owner configures the WAF rule below
in the Vercel dashboard.

## Public surfaces

`vercel.json` and the API handlers expose these public request paths:

| Surface | Public request | Handler behavior |
| --- | --- | --- |
| Share page | `GET` or `HEAD /wrapped/:shareId` | Rewritten to `api/wrapped.ts`; hydrates public metadata. |
| Social card | `GET` or `HEAD /wrapped/:shareId/x-card.png` | Rewritten to `api/wrapped.ts`; renders the public PNG. |
| Public share RPC | `POST /rpc/wrappedShare/getPublic` | Rewritten to `api/rpc.ts`; returns the public snapshot. |

The route parameter accepts the handler's `[A-Za-z0-9_-]+` share-ID alphabet.
Query strings do not change the WAF Request Path match.

## Required dashboard rule

Open the Vercel project, then **Firewall → Configure → New Rule** and enter the
following values exactly:

| Field | Value |
| --- | --- |
| Name | `wrapped-share-anonymous-source-limit` |
| If parameter | `Request Path` |
| Operator | `Matches expression` |
| Expression | `^(?:/wrapped/[A-Za-z0-9_-]+(?:/x-card\.png)?/?|/rpc/wrappedShare/getPublic/?)$` |
| Environment | `Production` |
| Then | `Rate Limit` |
| Strategy | `Fixed Window` |
| Time Window | `60s` |
| Request Limit | `600` |
| Counting key | `IP Address` |
| Follow-up action | `Default (429)` |
| Persistent action | Off |

Save the rule, select **Review Changes**, and **Publish**. A saved draft does
not protect traffic. First use the Firewall traffic view to confirm the path
expression matches only the three surfaces above; if operational policy
requires a log-only observation period, do that before publishing the final
429 action.

The `600 requests / 60 seconds / IP` threshold matches
`RATE_LIMIT_WRAPPED_SHARE_LOOKUP_SOURCE_MAX=600` and
`RATE_LIMIT_WRAPPED_SHARE_LOOKUP_WINDOW=60`. The application also defaults to
`180 requests / 60 seconds / shareId`, but dashboard WAF rules cannot key a
counter by a dynamic path capture. Approximating that counter with IP at 180
would penalize viewers behind shared NATs and would no longer match the source
cap. Keep the application backstop at 180 and use this WAF rule for the source
cap; this limitation is the accepted best-effort posture.

## Verification and rollback

After publishing, filter Firewall traffic by the rule name and confirm that:

1. Requests to each public surface appear under the rule.
2. A single test source receives HTTP 429 after exceeding 600 matching requests
   inside one fixed 60-second window.
3. Authenticated Wrapped creation and unrelated `/rpc/*` routes do not match.

If legitimate traffic is affected, disable this one rule and publish the
change. Do not alter the application limiter during the WAF rollback.

Vercel references: [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
[rule parameters and operators](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration),
and [custom-rule publishing](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules).
