# Data layer conversion runbook

Delisted apps, critical networks, and SAP ECC to API: three migrations with one destination, a server-side data layer you own that feeds your conversion funnels.

*YSL150 LLC · Apache-2.0 · last updated 2026-11-17*

Illustrations: [Delisted, or next in line?](https://files.ysl150.com/delisted-apps-data-layer.svg) · [Edge gating steps](https://files.ysl150.com/runbooks/gadget-migration/edge-gating.svg)

## Why these belong together

A delisted Shopify app, a router flooding an air traffic network, and an ERP reaching end of maintenance look like different problems. They fail the same way. Data moves between systems through a pipe nobody owns, with credentials that never expire, no gate at the edge, and no tested way back. Each one ends up in the same place:

1. **Sources:** Shopify, SAP ECC, routers and IoT devices, partner flows.
2. **Edge gate:** machine identity (ECC certificates), quarantine, per-source rate limit, explicit routing.
3. **System of record:** Xano or Postgres, every record keyed by a stable ID.
4. **Data layer:** server-side events and catalog, with consent attached.
5. **Conversion funnels:** Google Merchant and Ads, GA4, Meta, Amazon.

## The common failure: two shapes of data, never reconciled

The hardware isn't the root cause. Neither is the vendor. Each of these migrations puts **two shapes of the same data** side by side: the old system's and the new one's. They're connected before anyone has vetted that the new shape means what the old consumers expect.

| Migration | Old shape | New shape | What breaks when they aren't reconciled |
|---|---|---|---|
| Critical networks | Dial-up-era serial and copper links: one sender, one listener, no session | IP over fiber: connections, retries, broadcast | Traffic the old consumers never expected: repeated connection attempts and broadcast reach every center |
| Shopify apps | REST, non-expiring tokens, flat records | GraphQL, 1-hour tokens, nested products and variants | Variants detached from products, jobs failing mid-run, duplicate events |
| SAP ECC to API | Nightly files and IDocs, material numbers | Events and APIs, Shopify GIDs, ASINs, GTINs | Prices and stock that disagree between channels |
| Marketing data | Flat member lists copied on a date | Segments defined by query, consent per purpose | Audiences built on permission that's no longer true |

### Vet and reconcile before cutover

1. **Write both contracts down.** For each message or record, document the fields, types, units, size, rate, delivery pattern (one listener or broadcast) and retry behavior, in the old shape and the new.
2. **Map every field across.** A translation table from old to new, with an owner. A field with no mapping is a decision, not a gap to discover later.
3. **Vet at the gate.** The edge checks every new-shape message against its contract (schema, size, rate, destinations) before it reaches a consumer. A non-conforming source is quarantined, not passed through.
4. **Run both shapes in parallel and reconcile.** For every window (an hour, a day), compare counts, totals and a hash per record between old and new. Every difference gets a row in a discrepancy log, with a cause and an owner.
5. **Cut over only when reconciliation is clean** for an agreed period. Keep the reconciler running after cutover, because the old shape lingers in places nobody listed.

The rate limits, certificates and certification records below exist to make step 3 enforceable. On their own, they don't make two shapes agree.

## The clocks

| Date | What happens | Track |
|---|---|---|
| Aug 18, 2026 | Google's Content API for Shopping reached its sunset; degradation from Sep 1. Feeds move to the Merchant API. | Funnels |
| Nov 2026 | FAA nationwide ground stop traced to one newly installed router; senators ask for a pause until testing is complete | Critical networks |
| Dec 31, 2025 | SAP ECC 6.0 on enhancement packages 1–5 (or none) left mainstream maintenance, with no extended option | ECC |
| Jan 1, 2027 | Shopify public apps without expiring offline tokens are delisted and blocked from new installs | Delisted apps |
| Jan 15, 2027 | Merchants see a warning in their Shopify admin | Delisted apps |
| Mar 31, 2027 | Gadget platform shuts down | Delisted apps |
| Apr 1, 2027 | Shopify Admin API calls with non-expiring offline tokens return 403 | Delisted apps |
| Dec 31, 2027 | SAP ECC 6.0 (enhancement packages 6–8) mainstream maintenance ends | ECC |
| Dec 31, 2030 | SAP extended maintenance ends. Afterwards only customer-specific maintenance, or the RISE private-edition transition option (2031–2033). | ECC |

## Track A: Delisted and at-risk Shopify apps

Hundreds of apps have been pulled from the Shopify App Store this year. The listing goes first. Existing installs keep working until the token cutoff, so there's time to recover, but not much.

### Triage

| Reason | Check | Fix |
|---|---|---|
| Non-expiring offline tokens | Dev Dashboard and Shopify's email | Turn on expiring tokens; one refresh at a time per store; save the new access and refresh tokens together |
| No IP allowlist (public apps) | Dev Dashboard → app → Settings | Allowlist the networks your Admin API calls come from; on Cloudflare, use its [published ranges](https://www.cloudflare.com/ips/) split to /16 (IPv4) and /32 (IPv6) |
| An open App Review or governance request | Partner Dashboard messages and email | Answer in writing, keep a dated log of every follow-up, and escalate through your partner contact |
| REST-only integration | Code search for `/admin/api/*.json` | Move to the [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql), products and variants first |
| Missing or slow GDPR webhooks | Dev Dashboard → Webhooks delivery | Handle all three inline, so a failure is retried |

### Steps

1. **Confirm the reason in writing.** Save Shopify's notice and every reply.
2. **Fix compliance before re-listing.** Tokens, allowlist, webhooks, GraphQL.
3. **Keep current merchants working.** Delisting doesn't stop existing installs, but April 1, 2027 does for old tokens. Contact merchants who rarely open the app, because some token migrations need them to open it once.
4. **Clean up after any domain move.** Shop-scoped webhook subscriptions keep their old address and double every event. Sweep and delete them per store.
5. **Decide whether the data layer belongs in the App Store at all.** If the app exists to move data, a **custom app** created for each merchant's own store keeps the data layer outside the App Store. Custom apps are outside Shopify's expiring-token and public-app allowlist rules. The merchant owns the keys and the data. [Klaviyo Reshape](https://www.crm-sync.dev/products/klaviyo-merchant-reshape) is an example of a data layer delivered this way.
6. **If the app runs on Gadget,** follow the [Gadget migration runbook](https://files.ysl150.com/runbooks/gadget-migration/). Plan for January 1, 2027, not Gadget's March 31.

## Track B: Critical networks: data centers, routers and IoT

In November 2026, Reuters reported that a newly installed router at an FAA radio site sent about 1,000 connection attempts every four to five seconds. The overload hit 17 of 22 en route centers and caused a nearly five-hour nationwide ground stop. Blocking the suspect sites and turning off broadcast stabilized the network. Senators asked for independent validation, verified failover and rollback procedures before further rollout.

The same controls apply to any network where many devices feed a few central systems: data centers, store networks, warehouse scanners, IoT fleets.

### Gate

1. **Inventory every device** that talks to a central system: model, firmware, site, owner, and expected message rate.
2. **Give each device an identity.** Use an mTLS client certificate or signed requests. No identity, no entry.
3. **Set a per-device rate limit** at the edge, at a multiple of the expected rate. Alert well below the limit.
4. **Turn broadcast off by default.** Every destination is named in a routing table.
5. **Keep a quarantine list** that cuts off one device or site in seconds, without a deploy.

### Certify before rollout

1. **Independent validation:** a lab test by someone other than the installer, including a 10× overload test.
2. **Canary first:** one site, watched for a set period, then the next cohort.
3. **Verified failover:** switch to the old path at least once, on purpose, before cutover.
4. **Rehearsed rollback:** written and timed. For devices, the quarantine list is step one.
5. **Recorded evidence:** results, who ran them, and when, kept with the release.

Full controls and a Cloudflare Worker example: [Gating data at the edge](https://files.ysl150.com/runbooks/gadget-migration/#gating-data-at-the-edge-rate-limits-and-certified-testing).

## Machine identity and certification

Every source in this runbook is a machine: a store's app, an SAP middleware node, a router, a scanner. Each one needs an identity it can prove, a certification record that says what was tested, and a map of the data it depends on and feeds.

> **Two meanings of ECC.** In Track C, ECC is **SAP ERP Central Component**. Here, ECC is **elliptic-curve cryptography**, the key type for machine certificates. An SAP ECC system can and should connect with ECC certificates.

### ECC certificates for machines

| Decision | Recommendation |
|---|---|
| **Key type** | Elliptic curve P-256 (ECDSA, ES256). Smaller keys and faster handshakes than RSA, well suited to routers and IoT devices. |
| **Where the key lives** | Generated on the machine, in a TPM or secure element where it has one. The private key never leaves the device. |
| **Which certificate authority** | A **private CA you control** for machine-to-edge mTLS: only your systems need to trust it, and you can rotate it on your own schedule. Use a **public CA** only where outside parties must trust the machine, and choose one you could replace quickly (see the eMudhra case below). |
| **Lifetime** | Short. The 1-hour token logic applies here: a certificate read off a stolen device should stop working soon. Renewal is automated, not a calendar reminder. |
| **Use** | mTLS from the machine to the edge gate. The gate checks the certificate against your CA before any other check. Cloudflare validates [client certificates](https://developers.cloudflare.com/ssl/client-certificates/), including ones issued by [your own CA](https://developers.cloudflare.com/ssl/client-certificates/byo-ca/) where your plan supports it. |
| **Inventory** | One record per certificate: machine, site, owner, serial, expiry, revocation status. Alert 30 days before expiry. An expired certificate on a critical link is an outage you scheduled yourself. |
| **Revocation** | Revoking a certificate is the quarantine list for identity. Test it: revoke a lab device and confirm the edge refuses it within minutes. |

Use the same certificates for SAP connections: middleware or SAP nodes calling the edge API present their own ECC client certificates, kept separate from SAP user passwords.

### When a CA fails: the eMudhra case

In 2026, eMudhra's emSign certificate hierarchy lost browser trust:
- **Weak keys:** Inc42 [reported on Oct 31, 2026](https://inc42.com/features/emudhra-has-quit-tls-the-accountability-questions-havent/) that a researcher showed the private keys of eight certificate authorities under eMudhra's global hierarchy were weak enough to work out. The keys were generated at a single key ceremony and went undetected across two audit cycles.
- **Root distrust and exit:** per the same report, Chrome removed the **emSign ECC Root CA – G3** effective Oct 27, and eMudhra announced on Oct 22 that it is winding up its TLS certificate business.
- **Mozilla's record:** Mozilla's root program [tracks removal of four emSign roots](https://bugzilla.mozilla.org/show_bug.cgi?id=2018979). eMudhra's disclosure there lists its non-TLS subordinate CAs, including **emSign ECC Device CA – G3**, as revoked on June 14, 2026 for "Cessation of Operation".

Any fleet whose machine certificates chained to those CAs had to be re-issued. What to take from it:
1. **Be able to replace your CA without touching firmware.** Devices carry an updatable trust bundle, or trust a CA you control. Never hard-code a single public root.
2. **Re-issue the whole fleet automatically.** If you can't renew every machine certificate within days, a CA failure becomes an outage.
3. **Check key quality yourself.** Generate keys in a TPM, secure element or HSM, and reject certificates whose public keys fail a basic strength check. Weak keys passed audits here.
4. **Watch root-program announcements** (Mozilla, Chrome, Apple, Microsoft) for every CA in your chain, and treat a distrust notice as an incident.

### Machine certification record

Before a machine joins a production network, and after every firmware or configuration change, keep one record per machine type and one per installed unit:

| Field | Example |
|---|---|
| Machine and role | Edge router, radio site uplink |
| Certified firmware and configuration | Version and hash of the approved configuration; broadcast off |
| Identity | ECC certificate serial and issuing CA; expiry |
| Expected traffic | Normal rate, alert threshold, hard limit at the edge |
| Tests passed | Independent validation, 10× overload, failover, rollback; who ran them and when |
| Canary result | Site, period watched, outcome |
| Rollback | Quarantine entry, previous configuration, time to restore |

Aviation already certifies airborne software and hardware this way: the FAA recognizes RTCA DO-178C for software ([AC 20-115D](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-115D.pdf)) and DO-254 for airborne electronic hardware ([AC 20-152A](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-152A.pdf)); see the FAA's [software and airborne electronic hardware page](https://www.faa.gov/aircraft/air_cert/design_approvals/air_software/software_regs). The November 2026 ground stop shows that ground networks feeding critical systems need the same evidence discipline. The senators asked for independent validation, verified failover and rollback procedures, and a certification record is how you show those exist.

### Rate limits per router and machine, in the mTLS rules: analysis to deploy

Identity alone doesn't vet data. A certified, correctly installed machine can still send a shape or volume its consumers never expected. Contract checks at the gate catch the shape. Limits tied to the certificate catch the volume, so every machine is limited as itself, not as a shared IP address.

**1. Analyze: baseline each machine class**

| Machine class | Measure | Example baseline | Alert | Hard limit at the edge |
|---|---|---|---|---|
| Site router (control plane) | New connection attempts per second | under 1 | 5 | 20 |
| Site router (data plane) | Messages per second, average and peak | measured per site | 2× peak | 5× peak |
| Data machine (sensor, scanner, IoT) | Messages per minute | measured per model | 3× normal | 10× normal |
| SAP middleware node | API calls per minute | per scheduled job | 2× job size | 5× job size |
| Shopify store webhooks | Deliveries per minute | per store | 5× normal | quarantine, answer 200 |

The figures are illustrative. Measure your own for two weeks before you set limits. For scale, the FAA router reportedly made about 1,000 connection attempts every four to five seconds, roughly 200 per second.

**2. Write the rules, in this order**

1. **Certificate verified** against your CA, or the request is refused.
2. **Not revoked or quarantined:** check by certificate fingerprint.
3. **Rate limit keyed by the certificate:** the limit set comes from the machine class in the certificate subject.
4. **Route** only to the destinations listed for that class.

```js
// Cloudflare Worker behind mTLS. request.cf.tlsClientAuth carries the verified client certificate.
// wrangler.jsonc: "ratelimits": [
//   { "name": "ROUTER", "namespace_id": "2001", "simple": { "limit": 20,  "period": 10 } },
//   { "name": "MACHINE", "namespace_id": "2002", "simple": { "limit": 600, "period": 60 } } ]
export default {
  async fetch(request, env, ctx) {
    const tls = request.cf?.tlsClientAuth;
    if (!tls || tls.certVerified !== "SUCCESS") return new Response("certificate required", { status: 403 });
    const id = tls.certFingerprintSHA256;                       // one machine = one certificate
    if (await env.QUARANTINE.get(id)) return new Response("quarantined", { status: 403 });
    const isRouter = /OU=router/i.test(tls.certSubjectDN);      // machine class from the certificate
    const { success } = await (isRouter ? env.ROUTER : env.MACHINE).limit({ key: id });
    if (!success) {
      ctx.waitUntil(env.EVENTS.send({ type: "rate_limited", id, subject: tls.certSubjectDN, at: Date.now() }));
      return new Response("rate limited", { status: 429, headers: { "retry-after": "10" } });
    }
    return fetch(request);                                      // explicit routing goes here
  },
};
```

References: [`request.cf.tlsClientAuth`](https://developers.cloudflare.com/workers/runtime-apis/request/), [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (periods of 10 or 60 seconds).

**3. Deploy in stages**

1. **Log only:** run the rules for a week without blocking. Record which machines would have been limited, and fix the limits or the machines.
2. **Enforce on one canary site.** Watch alerts and the downstream systems.
3. **Enforce fleet-wide in cohorts,** each with a rollback: the rules switch back to log-only with one setting.
4. **Review monthly:** limits follow traffic growth, and every limit hit has an owner.

### Legacy links: when the machine can't speak HTTPS

Much of the data in critical networks doesn't travel server to HTTPS. It runs over 20-year-old dial-up-era serial and copper circuits that have no TLS, no certificate and no rate limit. The FAA's network was in the middle of a copper-to-fiber transition when one replacement router flooded it, and the routers being replaced were [reported as about 25 years old](https://www.yahoo.com/news/us/articles/us-probes-why-router-installation-182834297.html).

These machines can't present a certificate, so the gate moves to the point where the legacy link is converted:

1. **Put a gateway at the converter** (the copper-to-fiber or serial-to-IP point). The gateway holds the ECC certificate and speaks mTLS to the edge for the circuit behind it.
2. **Rate limit per circuit at the gateway,** as well as at the edge. The gateway is the only place that can tell one circuit from another.
3. **Turn broadcast off in the converter's configuration.** A legacy protocol that assumed one listener must not reach every center.
4. **Certify the gateway like any machine:** configuration hash, overload test, failover to the old circuit, rollback.
5. **Map the circuit in the dependency map** with its own row: what it carries, what depends on it, and its limit.

### Data dependency map

For each machine, write down what it consumes and what depends on it. The FAA overload started at one radio site and reached 17 of 22 en route centers, a dependency nobody had drawn.

| Machine | Consumes | Feeds | Downstream impact if it floods or fails | Failover |
|---|---|---|---|---|
| *Radio site router* | Network management, radio traffic | En route centers' communications and radar feeds | Many centers, if broadcast is on | Block at the edge; previous router |
| *SAP ECC middleware node* | ECC materials, prices, stock | Edge API, store, channels | Prices and stock go stale | Serve last good copy from the system of record |
| *Shopify app webhook endpoint* | Store events | Catalog, funnels | Duplicate or failed deliveries | Acknowledge and queue; quarantine one store |

Rules for the map:
1. **Every arrow has a rate limit and an owner.** A dependency with no limit is a path for one machine to flood many.
2. **Draw fan-out on purpose.** Any machine that feeds more than one critical system gets broadcast off and an explicit routing table.
3. **Review the map at every rollout,** and attach it to the certification record.

## Track C: SAP ECC to API

ECC holds the master data (materials, customers, prices, stock), and usually feeds the store through nightly files, IDocs or MuleSoft flows. Whether you move to S/4HANA, RISE or something else, the same API layer is needed, so building it now isn't wasted.

### Principles

- **Nothing new talks to ECC directly.** New consumers call an API at the edge, which reads from the system of record. ECC is read by one owner, on a schedule, with read-only credentials.
- **ECC's sign-on is a single point of failure.** Keep a copy of what the store needs, so a logon or system outage doesn't stop sales.
- **Map identifiers once.** One product key maps SAP material number, GTIN, Shopify product and variant GIDs, Amazon ASIN, and Google Merchant offer ID. The same goes for customers.

### Steps

1. **Inventory the interfaces:** every file, IDoc, RFC/BAPI call, OData service and middleware flow that moves data in or out of ECC, with its direction, schedule and owner.
2. **Choose the read path per object:** OData services through SAP Gateway where they exist, RFC/BAPI through middleware where they don't, and files only as a last resort. Use a read-only technical user, scoped to what the move needs.
3. **Land the data in staging tables** in Xano or Postgres, raw and as received. Transform with reviewed, re-runnable SQL into the final tables, keyed by the mapped identifiers.
4. **Put the API in front:** an edge Worker serves the store, channels and partners from the system of record, with the gate from Track B (identity, rate limit, quarantine).
5. **Writes go back through a queue.** Orders, returns and customer changes go into a queue that retries with backoff and alerts when an item is overdue. A failed write is saved before the sender is told it succeeded.
6. **Dual run:** compare ECC and the new layer daily (counts, prices, stock on a sample of products) before any channel switches over.
7. **Cut over one channel at a time,** with a rehearsed rollback to the old flow.

## Data layer conversion funnels

Once the data is in a system of record you own, every funnel reads from the same place.

| Funnel | What it needs from the data layer | Server-side path |
|---|---|---|
| **Google Merchant / Shopping** | A catalog in the shape Merchant reads, with every variant tied to its product | [Merchant API](https://developers.google.com/merchant/api) (the Content API for Shopping is past its sunset) |
| **Google Ads / GA4** | Purchase and funnel events with consent | [Server-side tagging](https://developers.google.com/tag-platform/tag-manager/server-side) on your own subdomain; [GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4) |
| **Meta** | The same events, with a shared event ID for [deduplication](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/) | [Meta Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/) |
| **Amazon** | Catalog keyed by ASIN, plus price and stock | [Amazon Selling Partner API](https://developer-docs.amazon.com/sp-api/) |
| **Email and loyalty** | Segments defined by query, not copied member lists | Your own database, read by the platform |

### Rules

1. **Consent travels with every event.** Send all four Google [consent signals](https://developers.google.com/tag-platform/security/guides/consent) (analytics storage, ad storage, ad user data, ad personalization), plus your own record of where the consent came from. An event without consent fields can look successful and still be unusable.
2. **One event ID per action,** shared between browser and server, so each platform deduplicates instead of double-counting.
3. **Server-side first.** When an agent or a back-office system completes a purchase, there's no browser, page view or cookie. Only server-side events count it.
4. **Never copy permission.** A list membership copied on Tuesday is only true on Tuesday. Copy the definition of a segment, and re-confirm consent where the law requires it.
5. **Shape per destination,** not one feed for all: nested products for Merchant, ASIN-keyed records for Amazon, events for Ads and Meta.

## Checklist

- [ ] Clocks that apply to you listed, with owners and target dates ahead of each
- [ ] **Two shapes reconciled:** old and new contracts written; every field mapped with an owner; contract checks at the gate; parallel run with a discrepancy log, clean for the agreed period before cutover
- [ ] **Track A:** delisting reason confirmed in writing; tokens, allowlist, GraphQL and GDPR webhooks fixed; stale webhooks swept; App Store or custom-app path decided
- [ ] **Track B:** devices inventoried with identity; per-device rate limits and alerts; broadcast off; quarantine list tested; certified rollout evidence kept
- [ ] **Machines:** ECC certificates (P-256) from a CA you can replace, fleet re-issue tested, inventory and expiry alerts, revocation tested; per-router and per-machine rate limits in the mTLS rules (log only → canary → fleet); legacy circuits gated at the converter; certification record per machine type and unit; data dependency map with a rate limit and owner on every arrow
- [ ] **Track C:** ECC interfaces inventoried; read-only path per object; staging and transformation reviewed; identifiers mapped once; API at the edge; write-back queue; dual run passed
- [ ] **Funnels:** catalog on the Merchant API; server-side events with all four consent signals; shared event IDs; one channel cut over at a time, each with a rollback

## References

- Gadget migration runbook, including edge gating and a Worker example: https://files.ysl150.com/runbooks/gadget-migration/
- PIM Sync on the Shopify App Store, a live app on this architecture: https://apps.shopify.com/pim-sync

**Sources:**
- [Shopify: expiring offline access tokens required for all public apps](https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027)
- [Shopify: app security updates, October 2026](https://shopify.dev/changelog/app-security-updates-october-2026)
- [Gadget: Gadget is winding down](https://gadget.dev/blog/gadget-wind-down)
- [Google: Content API for Shopping sunset](https://developers.google.com/shopping-content/guides/sunset)
- [Reuters via SRN News: senators urge FAA to pause router deployment pending testing](https://srnnews.com/us-senators-urge-faa-to-pause-new-router-deployment-pending-testing/)
- [Yahoo News (Reuters): US probes why a router installation sparked mass flight grounding](https://www.yahoo.com/news/us/articles/us-probes-why-router-installation-182834297.html)
- [Mozilla: eMudhra transition plan for existing dual-purpose roots (bug 2018979)](https://bugzilla.mozilla.org/show_bug.cgi?id=2018979)
- [Inc42: eMudhra has quit TLS (Oct 31, 2026)](https://inc42.com/features/emudhra-has-quit-tls-the-accountability-questions-havent/)
- [FAA: AC 20-115D, airborne software (DO-178C)](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-115D.pdf)
- [FAA: AC 20-152A, airborne electronic hardware (DO-254)](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-152A.pdf)
- [Cloudflare: client certificates (mTLS)](https://developers.cloudflare.com/ssl/client-certificates/) · [bring your own CA](https://developers.cloudflare.com/ssl/client-certificates/byo-ca/) · [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [Request `cf.tlsClientAuth`](https://developers.cloudflare.com/workers/runtime-apis/request/) · [IP ranges](https://www.cloudflare.com/ips/)
- [Google: Merchant API](https://developers.google.com/merchant/api) · [server-side tagging](https://developers.google.com/tag-platform/tag-manager/server-side) · [GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4) · [consent mode](https://developers.google.com/tag-platform/security/guides/consent)
- [Meta: Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/) · [deduplication](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/)
- [Amazon: Selling Partner API](https://developer-docs.amazon.com/sp-api/)
- [Shopify: GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql)
- [SAPinsider: SAP support deadlines 2027, 2030, 2033](https://sapinsider.org/blogs/sap-support-deadlines-2027-2030-2033/)
- [The Register: SAP extends support deadline](https://www.theregister.com/2025/01/28/sap_extends_support_deadline/)

Help with any track: Yoonsun Lee · YSL150 LLC · [ysl@ysl150.com](mailto:ysl@ysl150.com)
