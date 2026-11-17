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
| No IP allowlist (public apps) | Dev Dashboard → app → Settings | Allowlist the networks your Admin API calls come from; on Cloudflare, use its published ranges split to /16 (IPv4) and /32 (IPv6) |
| An open App Review or governance request | Partner Dashboard messages and email | Answer in writing, keep a dated log of every follow-up, and escalate through your partner contact |
| REST-only integration | Code search for `/admin/api/*.json` | Move to the GraphQL Admin API, products and variants first |
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
| **Which certificate authority** | A **private CA** for machines only your systems need to trust. A **public CA** when partners or third-party networks must trust them. eMudhra (emSign) is one public CA that issues ECC certificates, including for device and IoT identity. Before you choose a root, check that the devices and platforms you connect to trust it. |
| **Lifetime** | Short. The 1-hour token logic applies here: a certificate read off a stolen device should stop working soon. Renewal is automated, not a calendar reminder. |
| **Use** | mTLS from the machine to the edge gate. The gate checks the certificate against your CA before any other check. Cloudflare can validate client certificates issued by your own CA where your plan supports it. |
| **Inventory** | One record per certificate: machine, site, owner, serial, expiry, revocation status. Alert 30 days before expiry. An expired certificate on a critical link is an outage you scheduled yourself. |
| **Revocation** | Revoking a certificate is the quarantine list for identity. Test it: revoke a lab device and confirm the edge refuses it within minutes. |

Use the same certificates for SAP connections: middleware or SAP nodes calling the edge API present their own ECC client certificates, kept separate from SAP user passwords.

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

Aviation already certifies airborne software and hardware this way (RTCA DO-178C and DO-254). The November 2026 ground stop shows that ground networks feeding critical systems need the same evidence discipline. The senators asked for independent validation, verified failover and rollback procedures, and a certification record is how you show those exist.

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
| **Google Merchant / Shopping** | A catalog in the shape Merchant reads, with every variant tied to its product | Merchant API (the Content API for Shopping is past its sunset) |
| **Google Ads / GA4** | Purchase and funnel events with consent | Server-side tagging on your own subdomain; GA4 Measurement Protocol |
| **Meta** | The same events, with a shared event ID for deduplication | Meta Conversions API |
| **Amazon** | Catalog keyed by ASIN, plus price and stock | Amazon Selling Partner API |
| **Email and loyalty** | Segments defined by query, not copied member lists | Your own database, read by the platform |

### Rules

1. **Consent travels with every event.** Send all four Google consent signals (analytics storage, ad storage, ad user data, ad personalization), plus your own record of where the consent came from. An event without consent fields can look successful and still be unusable.
2. **One event ID per action,** shared between browser and server, so each platform deduplicates instead of double-counting.
3. **Server-side first.** When an agent or a back-office system completes a purchase, there's no browser, page view or cookie. Only server-side events count it.
4. **Never copy permission.** A list membership copied on Tuesday is only true on Tuesday. Copy the definition of a segment, and re-confirm consent where the law requires it.
5. **Shape per destination,** not one feed for all: nested products for Merchant, ASIN-keyed records for Amazon, events for Ads and Meta.

## Checklist

- [ ] Clocks that apply to you listed, with owners and target dates ahead of each
- [ ] **Track A:** delisting reason confirmed in writing; tokens, allowlist, GraphQL and GDPR webhooks fixed; stale webhooks swept; App Store or custom-app path decided
- [ ] **Track B:** devices inventoried with identity; per-device rate limits and alerts; broadcast off; quarantine list tested; certified rollout evidence kept
- [ ] **Machines:** ECC certificates (P-256) per machine, inventory and expiry alerts, revocation tested; certification record per machine type and unit; data dependency map with a rate limit and owner on every arrow
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
- [SAPinsider: SAP support deadlines 2027, 2030, 2033](https://sapinsider.org/blogs/sap-support-deadlines-2027-2030-2033/)
- [The Register: SAP extends support deadline](https://www.theregister.com/2025/01/28/sap_extends_support_deadline/)

Help with any track: Yoonsun Lee · YSL150 LLC · [ysl@ysl150.com](mailto:ysl@ysl150.com)
