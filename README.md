# Gadget migration runbook

Move a Shopify app off Gadget, which shuts down on March 31, 2027, and onto Cloudflare with a database you control. The move also covers Shopify's January 1, 2027 deadline for expiring offline tokens, moving REST and MuleSoft (Salesforce) flows to GraphQL, and gating data from stores, routers and IoT devices with rate limits and certified rollout testing.

- **[RUNBOOK.md](RUNBOOK.md)**: the full runbook (inventory, export, dual run, Shopify cutover, decommission)
- **[DATA-LAYER-RUNBOOK.md](DATA-LAYER-RUNBOOK.md)**: delisted apps, critical networks and SAP ECC to API: machine identity with ECC certificates, certification records, data dependency maps, and one server-side data layer for conversion funnels. Read online: https://files.ysl150.com/runbooks/data-layer/
- **[scripts/gadget/export.mjs](scripts/gadget/export.mjs)**: exports every record through your app's generated Gadget client (NDJSON + manifest)
- **[scripts/gadget/load-postgres.mjs](scripts/gadget/load-postgres.mjs)**: loads the export into `gadget_import_*` staging tables in Postgres

Read online: https://files.ysl150.com/runbooks/gadget-migration/

```sh
npm install
npm test
```

Apache-2.0 · YSL150 LLC · ysl@ysl150.com
