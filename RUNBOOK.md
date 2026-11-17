# Gadget migration runbook

Move a Shopify app off [Gadget](https://gadget.dev) and onto infrastructure you own: Cloudflare Workers for the app, a database you control (Postgres, Cloudflare D1 or Xano), and Shopify's own app template for the parts Shopify requires. Gadget keeps running until the last step, and every step before cutover can be undone.

*YSL150 LLC · Apache-2.0 · last updated 2026-11-17*

## Why now: two clocks

On November 9, 2026, Gadget [announced it is shutting down](https://gadget.dev/blog/gadget-wind-down). Shopify's token deadline arrives three months before Gadget's.

| Date | What happens | Source |
|---|---|---|
| Nov 9, 2026 | Gadget announces the wind-down. New applications can't be started. | Gadget |
| End of November | Last first-time deploys to production on Gadget | Gadget |
| End of year | Gadget support ends; only critical issues afterwards | Gadget |
| **Jan 1, 2027** | Public apps without **expiring offline tokens** (1-hour access tokens with a refresh token) are delisted and blocked from new installs | [Shopify](https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027) |
| Jan 15, 2027 | Merchants see a warning in their Shopify admin | [Shopify](https://shopify.dev/changelog/app-security-updates-october-2026) |
| Mar 31, 2027 | Gadget platform shuts down | Gadget |
| Apr 1, 2027 | Admin API calls with non-expiring offline tokens return HTTP 403 | Shopify |

**Plan for January 1, not March 31.** A public app has to be on expiring tokens by then wherever it runs. Moving off Gadget and moving to expiring tokens can be one cutover instead of two.

Gadget's announcement says migration guides and tools are coming. Until they ship, this runbook uses what Gadget already provides:

- **Code:** `ggt` syncs your app's files to a local folder you can commit to Git ([ggt docs](https://docs.gadget.dev/reference/ggt)).
- **Data:** each app's generated API client, which pages through records 250 at a time. `ggt` doesn't copy database records. [`scripts/gadget/export.mjs`](scripts/gadget/export.mjs) does.

## What maps to what

| Gadget | Where it goes | Effort |
|---|---|---|
| **Models** (`api/models/<model>/schema.gadget.ts`) | Tables in Postgres, D1 or Xano. Land raw records in `gadget_import_*` staging tables first, then write SQL into your final schema. | Medium: schema by hand, data by script |
| **Model actions** (`create`, `update`, `delete`, custom; `run` / `onSuccess`) | Worker route handlers. Side effects that ran in `onSuccess` become queued events. | High: this is your business logic |
| **Global actions** (`api/actions/*`) | Worker routes, with machine-only actions behind a signature or certificate check | Medium |
| **Background actions** (`enqueue`) | Cloudflare Queues | Low to medium |
| **Scheduled actions** | Workers Cron Triggers | Low |
| **HTTP routes** (`api/routes/`, Fastify) | Worker `fetch` routes; request/reply become `Request`/`Response` | Low to medium |
| **Access control** (`accessControl/permissions.gadget.ts`) | No generated equivalent. Write the checks yourself: Shopify session tokens in the app, signatures for machines, row filters in SQL. | High: review every model |
| **Generated API client / GraphQL API** | Your own API. Frontends that call `api.model.findMany()` must call your endpoints instead. | High |
| **Shopify OAuth, managed installs** | [Shopify's React Router app template](https://github.com/Shopify/shopify-app-template-react-router) on Cloudflare, with **expiring offline tokens turned on** | Low to medium |
| **Shopify webhooks** (registered automatically) | `[webhooks]` in `shopify.app.toml`, verified by HMAC, answered within 5 seconds | Medium |
| **Synced Shopify models + daily reconciliation** | Usually not needed. Query the Admin API when you need data; mirror only what you must, with a Cron job plus bulk operations. | Medium; often a simplification |
| **GDPR / compliance webhooks** | `customers/data_request`, `customers/redact` and `shop/redact`, covering the data you now store | Required, and easy to forget |
| **Billing** (app subscriptions, usage records) | The template's billing helpers. Existing subscriptions stay with Shopify, keyed to your app. | Low if you keep the same Shopify app |
| **Frontend** (`web/`, Vite + React + App Bridge) | The embedded admin inside the app template | Medium |
| **File fields** | Cloudflare R2. Copy files during backfill; don't rely on export URLs staying valid. | Low to medium |
| **Environments** (`<app>--development.gadget.app`, production) | Wrangler environments or separate Workers, plus preview URLs | Low |
| **Environment variables and secrets** | `vars` and `wrangler secret put` | Low |
| **User accounts with passwords** | Gadget doesn't export password hashes. Plan a password reset or another sign-in method. Embedded Shopify apps use Shopify session tokens and are unaffected. | Low to high |
| **Logs** | Workers Logs and observability | Low |

Most of the effort is in actions, access control and the generated API. The data copy is the easy part.

## Phase 0: Inventory (a day, nothing changes)

1. **Pull the code into Git.**
   ```sh
   npm install -g ggt
   # ggt dev syncs both ways: stop it with Ctrl+C once the first sync finishes, and don't edit while it runs.
   ggt dev ./my-gadget-app --app <your-app> --env development
   cd my-gadget-app
   ggt pull --env=production --force      # match what's deployed to production
   git init && git add -A && git commit -m "Gadget app snapshot"
   ```
2. **List what you have.**
   ```sh
   ls api/models                 # models
   find api -path '*actions*'    # model and global actions
   ls api/routes 2>/dev/null     # HTTP routes
   cat accessControl/permissions.gadget.ts
   cat settings.gadget.ts        # Shopify connection, scopes
   ```
3. **Write down the Shopify app's identity:** the client ID in `shopify.app.toml` and the Partner organization that owns the app. You keep this same Shopify app, so merchants don't reinstall.
4. **Count records per model**, so you can verify the export later.
5. **List every Admin API caller outside Gadget** (scripts, middleware, partner tools). Public apps must allowlist the networks their tokens are used from, so each caller needs a home on the new stack.

## Phase 1: Optional edge layer (Gadget stays the system of record)

If storefront writes (signups, consent, uploads) go to Gadget today, put a Cloudflare Worker in front and forward them. If Gadget has an outage, writes wait in a queue instead of being lost, and the same Worker becomes the new home for those writes later.

Sign each forwarded event with [Standard Webhooks](https://www.standardwebhooks.com/) and verify it in a Gadget route at `api/routes/webhooks/POST-edge.ts`, with `EDGE_WEBHOOK_SECRET` set as a secret in Gadget:

```typescript
import { RouteHandler } from "gadget-server";
import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies a Standard Webhooks signature, then hands the event to your own action.
const route: RouteHandler = async ({ request, reply, logger }) => {
  const secret = process.env["EDGE_WEBHOOK_SECRET"] ?? "";
  const id = String(request.headers["webhook-id"] ?? "");
  const timestamp = String(request.headers["webhook-timestamp"] ?? "");
  const signatures = String(request.headers["webhook-signature"] ?? "").split(" ");

  // The sender signs JSON.stringify(event) and Fastify parses it, so stringifying the
  // parsed body reproduces the exact bytes that were signed.
  const body = JSON.stringify(request.body);
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret);
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  const valid = fresh && signatures.some((s) => {
    const got = Buffer.from(s.replace(/^v1,/, ""), "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!valid) return reply.code(401).send({ error: "bad signature" });

  const event = request.body as { id: string; type: string; data: Record<string, unknown> };
  // Retries reuse the same id: store event.id with a unique constraint and skip duplicates.
  logger.info({ id: event.id, type: event.type }, "edge event");
  return reply.code(204).send();
};

export default route;
```

**To undo:** stop forwarding. Gadget is unchanged.

## Phase 2: Backfill and dual run

### Export everything from Gadget

Create a Gadget API key under **Settings → API Keys** with a role that can **read** the models you're exporting and nothing more.

```sh
npm install
npm config set @gadget-client:registry https://registry.gadget.dev/npm
npm install --no-save @gadget-client/<your-app>

GADGET_API_KEY=gsk-... node scripts/gadget/export.mjs \
  --client @gadget-client/<your-app> --env production \
  --models customer,subscription,shopifyShop \
  --out export/
```

The script pages through each model 250 records at a time, sorted by `updatedAt`, and writes `export/<model>.ndjson` plus a `manifest.json` with counts. Compare the counts with Phase 0.

The export holds your customers' data. Keep it off shared drives and out of Git (`export/` is in `.gitignore`), and delete it after cutover.

### Load into Postgres

```sh
DATABASE_URL=postgres://... node scripts/gadget/load-postgres.mjs export/
```

Each model lands in `gadget_import_<model>` (`id`, `data jsonb`, `updated_at`). Loading upserts by `id`, so it's safe to re-run. Then write the transformation into your real tables as plain SQL you can review and re-run:

```sql
INSERT INTO signups (email, marketing_consent, consent_source, captured_at, country)
SELECT lower(data->>'email'), coalesce((data->>'acceptsMarketing')::boolean, false), 'gadget_import',
       (data->>'createdAt')::timestamptz, data->>'country'
FROM gadget_import_customer
WHERE data->>'email' IS NOT NULL
ON CONFLICT (email) DO NOTHING;
```

Don't turn any value into marketing consent unless the source field actually recorded an opt-in.

For D1 or Xano, use the same NDJSON files with `wrangler d1 execute` or a Xano bulk-import endpoint. Key Shopify-derived records by their Shopify GID, not a Gadget ID. Products, collections and orders can often be re-read from Shopify with a bulk operation after cutover instead of copied.

### Run both

- Rebuild actions and routes as Worker handlers, one model at a time, against the new tables.
- Feed the same events to both systems and compare daily: counts, a sample of records, and Shopify-facing behavior.
- Point a **development copy** of your Shopify app (a separate app with its own client ID, on a development store) at the new stack. Test install, the embedded admin, webhooks and billing there first.

**To undo:** stop the new handlers. Gadget is still the system of record.

## Phase 3: Move the Shopify integration

This is the step merchants could notice, so plan a short change window, before January 1, 2027.

1. **Same Shopify app, new URLs.** In `shopify.app.toml`, change `application_url`, `[auth] redirect_urls` and the `[webhooks]` subscription URIs from `*.gadget.app` to your new app, then run `shopify app deploy`. The client ID stays the same, so merchants don't reinstall, and billing subscriptions keep belonging to your app.
2. **Expiring offline tokens from day one.** Turn them on in the new app. Access tokens last one hour, and **the refresh token is replaced every time you use it**. Allow one refresh at a time per store, and save the new access and refresh tokens together. Two workers refreshing at once leave one of them with a dead refresh token, and the merchant has to reopen the app ([Shopify's migration guide](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens)).
3. **Carry the tokens over.** Gadget stores each shop's offline token on the `shopifyShop` model ([Gadget OAuth docs](https://docs.gadget.dev/guides/plugins/shopify/advanced-topics/oauth)). Check whether your read-only key can read it.
   - **If it can:** exchange each non-expiring token for an expiring one in a background job, and store the result encrypted. Background work keeps running from minute one.
   - **If it can't:** the app gets a new token through token exchange the next time each merchant opens it. Background jobs for that store wait until then. Contact merchants who rarely open the app, before January.
4. **Re-create shop-scoped webhooks, and delete the old ones.** Subscriptions created per store through the Admin API (not the ones in `shopify.app.toml`) keep their old address after the move. The store then sends every event twice, once to each address, and slow copies count as delivery failures. List the app's subscriptions per store (`webhookSubscriptions`), re-create what you need at the new URI, and delete any pointing at `*.gadget.app`. Repeat weekly for a while, because stores that were asleep during cutover need it too.
5. **IP allowlist.** Public apps must allowlist the networks their Admin API calls come from: up to 100 entries, IPv4 /16 or narrower, IPv6 /32 or narrower, set in the Dev Dashboard. On Cloudflare, use [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/) split to those sizes. The ASN option doesn't match Workers traffic. Run the Dev Dashboard traffic test before you enforce.
6. **Compliance webhooks.** Handle `customers/data_request`, `customers/redact` and `shop/redact` for every table you now hold. Run them inline, not in the background, so a failure returns an error and Shopify retries.
7. **Answer webhooks within 5 seconds.** Acknowledge at once and finish the work in the background (`ctx.waitUntil` or a queue). Shopify counts a slow answer as a failed delivery.
8. **Watch closely for 48 hours:** installs, uninstalls, webhook delivery (Dev Dashboard → your app → Webhooks), token refresh failures, and billing.

**To undo:** point `shopify.app.toml` back at the `*.gadget.app` URLs and run `shopify app deploy` again. Gadget still has its tokens and data until March 31, 2027.

## Phase 4: Cut over and decommission

1. Pause writes in Gadget: disable the actions and routes that write.
2. Export only what changed since the full export, then load it:
   ```sh
   GADGET_API_KEY=gsk-... node scripts/gadget/export.mjs --client @gadget-client/<your-app> \
     --models customer,subscription,shopifyShop --since 2026-12-01T00:00:00Z --out export-delta/
   DATABASE_URL=postgres://... node scripts/gadget/load-postgres.mjs export-delta/
   ```
   Re-run your transformation SQL, then check counts one last time.
3. Keep the Gadget app read-only for as long as you need a fallback, but no later than March 31, 2027. Then delete it, along with the API key and the export files.

## REST integrations and MuleSoft / Salesforce flows

Many stores also feed Shopify from Salesforce (Commerce Cloud, Sales or Service Cloud, or an ERP) through MuleSoft or other middleware calling the Admin REST API. Those flows run into the same deadlines as a Gadget app, and they're often the last to be found.

| Date | Change | Source |
|---|---|---|
| Oct 1, 2024 | The REST Admin API became **legacy**. It stays available but gets no new features, and some newer platform features exist only in GraphQL. | [Shopify](https://www.shopify.com/partners/blog/all-in-on-graphql) |
| Feb 1, 2025 | Public apps had to move to the new GraphQL product APIs. Custom apps had until Apr 1, 2025. | [Shopify](https://shopify.dev/changelog/deprecation-timelines-related-to-new-graphql-product-apis) |
| Apr 1, 2025 | New public apps submitted to the App Store must use the GraphQL Admin API only | [Shopify](https://shopify.dev/changelog/starting-april-2025-new-public-apps-submitted-to-shopify-app-store-must-use-graphql) |
| Jan 1, 2027 | Public apps need expiring offline tokens, whether the calls are REST or GraphQL | [Shopify](https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027) |

Shopify hasn't published a final date for switching off REST for existing apps. Treat REST as borrowed time.

**What breaks in a MuleSoft or REST flow**
- **Token lifetime.** A flow that reads a Shopify token from a properties file once and uses it all night stops after an hour, if the token belongs to a public app. MuleSoft shouldn't refresh tokens itself: several flows sharing one store's refresh token invalidate each other. Get a fresh token from one owner per store (a small token service on Cloudflare), or run the flow on a **custom app** created for that store. Shopify's expiring-token requirement doesn't cover custom apps.
- **IP allowlist.** Public apps must allowlist the networks their calls come from. MuleSoft CloudHub workers need static IPs (or a VPC with fixed egress) for Shopify to accept them. Custom apps are outside the allowlist rule.
- **REST product endpoints.** Product and variant endpoints were the first to move to GraphQL. Flows still on REST products are the most exposed.
- **Volume.** Nightly REST loops over orders or products are slow and use up rate limits. GraphQL bulk operations export the same data as one file. The download link for the results is pre-signed and needs no token.

**Migration steps**
1. List every flow that calls Shopify: endpoint, HTTP method, how often, which app's token, and which network it runs from.
2. Move each REST call to its GraphQL Admin equivalent, starting with products and variants. Replace large REST loops with bulk operations.
3. Decide each flow's token owner: a custom app for that store, or a token service shared by every flow.
4. Give the flows fixed exit IPs and add them to the public app's allowlist. Run the Dev Dashboard traffic test before you enforce it.
5. Point inbound Shopify webhooks at an endpoint that answers within 5 seconds and passes the work on to MuleSoft through a queue, not inline.

## Gating data at the edge: rate limits and certified testing

In November 2026 one newly installed router took down US air traffic control. Reuters reported the following ([Nov 17, 2026](https://srnnews.com/us-senators-urge-faa-to-pause-new-router-deployment-pending-testing/)):
- A Juniper router that L3Harris installed at an FAA radio site in El Dorado, Arkansas, sent about 1,000 connection attempts every four to five seconds.
- The data overload hit 17 of the FAA's 22 en route centers, disrupting radio and radar feeds.
- It led to a nearly five-hour nationwide ground stop and more than 18,000 cancelled flights.
- The network stabilized once the suspect sites were blocked and the routers' broadcast function was turned off.
- Thirteen senators then asked the FAA to pause further deployments until it has **independent validation, verified failover and rollback procedures**.

An app migration has the same failure mode on a smaller scale. One source (a store, an IoT device, a router, a partner flow) sends far more than it should, and with no gate at the edge it reaches every system behind it. During the migration that wrote this runbook, one free-plan store sent a product update every few seconds, to two addresses at once. That's the same shape of problem.

### Gate every source at the edge

| Control | What it does | Where |
|---|---|---|
| **Per-source rate limit** | Caps requests per store, device or partner key, so one source can't flood the rest | Cloudflare Workers rate-limiting binding, keyed by source |
| **Quarantine list** | Cuts off one source without a deploy, and undoes just as fast | A Worker variable or KV list checked before any work |
| **No fan-out by default** | A source can't broadcast to everything; each destination is explicit | Routing table in the Worker; broadcast off unless approved |
| **Device identity** | Routers and IoT devices prove who they are before sending data | mTLS client certificates, or signed requests (HMAC) |
| **Shopify exception** | Shopify counts a rejected webhook as a failure, so gate webhooks by **answering 200 and dropping**, not with 429 | Webhook route |

```js
// wrangler.jsonc: "ratelimits": [{ "name": "PER_SOURCE", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } }]
export default {
  async fetch(request, env) {
    const source = request.headers.get("x-shopify-shop-domain")   // a store
      || request.headers.get("x-device-id")                       // a router or IoT device (after mTLS)
      || "unknown";
    const quarantined = (env.QUARANTINE || "").split(/[\s,]+/).includes(source);
    const { success } = await env.PER_SOURCE.limit({ key: source });
    if (quarantined || !success) {
      // Shopify webhooks: acknowledge and drop, or Shopify records a failed delivery.
      if (request.headers.has("x-shopify-topic")) return new Response(null, { status: 200 });
      return new Response("rate limited", { status: 429, headers: { "retry-after": "60" } });
    }
    return fetch(request); // on to the app
  },
};
```

### Certify before you roll out

Run every new device, app version or integration through the steps the senators asked of the FAA:

1. **Independent validation:** test on a development store or a lab device, by someone other than the person who built it. Include an overload test: send 10 times normal traffic and confirm the gate holds.
2. **Canary first:** one store or one site, watched for a set period, before the next cohort. The FAA rollout had about 400 of 3,648 routers installed when it was stopped.
3. **Verified failover:** prove the old path still works while the new one runs, and switch between them on purpose at least once before cutover.
4. **Rollback procedure:** written, timed and rehearsed. For a Shopify app that's `shopify app deploy` of the previous version plus the previous URLs. For a device, it's the quarantine list.
5. **Record the evidence:** test results, who ran them and when, kept with the release, so "is it ready?" has a factual answer.

## After cutover: what to watch

| Signal | Meaning |
|---|---|
| Webhook 499s or 5xx | The app isn't answering within 5 seconds. Move work to the background. |
| Token refresh failures (401 `invalid_request`) | A broken token chain; the merchant must reopen the app |
| 403 "IP restrictions" | Something still calls the Admin API from outside your allowlisted network |
| The same event twice | A stale shop-scoped subscription at the old address |
| Missing records | Re-run a bulk read for that store |
| One source far above its usual rate | Quarantine it at the edge first, then investigate |

## Checklist

- [ ] Code in Git (`ggt pull`); models, actions, routes and permissions listed
- [ ] Shopify app client ID and owning Partner organization confirmed
- [ ] Outside Admin API callers listed, each with a home on the new stack
- [ ] Read-only Gadget API key; full export; counts match the inventory
- [ ] Staging tables loaded; transformation SQL reviewed; consent mapped only from real opt-ins
- [ ] Actions rebuilt as Worker handlers; access-control rules reimplemented and tested
- [ ] Development copy of the Shopify app tested end to end on the new stack
- [ ] Expiring offline tokens on; one refresh at a time per store; tokens carried over or merchants contacted
- [ ] `shopify.app.toml` URLs switched; shop-scoped webhooks re-created and old ones deleted
- [ ] IP allowlist set and tested; compliance webhooks live and inline
- [ ] Final `--since` delta exported and loaded; Gadget writes paused, then app retired before March 31, 2027
- [ ] MuleSoft / REST flows listed, moved to GraphQL, given a token owner and fixed exit IPs
- [ ] Per-source rate limit and quarantine list at the edge; overload test passed
- [ ] Certified rollout: independent validation, canary, failover switched once, rollback rehearsed, evidence recorded
- [ ] Export files and the Gadget API key deleted

## A live app on this stack

[PIM Sync on the Shopify App Store](https://apps.shopify.com/pim-sync) runs on the architecture this runbook lands on:
- A Shopify app on Cloudflare, with expiring offline tokens.
- An allowlisted Cloudflare network.
- Xano as the system of record.
- Webhooks answered at once, plus a weekly sweep of stale subscriptions.

PIM Sync's source is private. This runbook and its scripts are public under Apache-2.0.

Migration help: Yoonsun Lee · YSL150 LLC · [ysl@ysl150.com](mailto:ysl@ysl150.com)
