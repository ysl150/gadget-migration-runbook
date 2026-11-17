#!/usr/bin/env node
// Export records from a Gadget app with the app's own generated API client.
//
//   npm config set @gadget-client:registry https://registry.gadget.dev/npm
//   npm install --no-save @gadget-client/<your-app>
//   GADGET_API_KEY=gsk-... node scripts/gadget/export.mjs \
//     --client @gadget-client/<your-app> --env production \
//     --models customer,subscription,shopifyShop --out export/
//
// Writes export/<model>.ndjson (one record per line) and export/manifest.json.
// --since <ISO time> exports only records updated after that time (for the final delta before cutover).
import fs from 'node:fs';
import path from 'node:path';

export async function exportModel(manager, { since, pageSize = 250, onPage = () => {} } = {}) {
  const records = [];
  let after = null;
  for (;;) {
    const opts = { first: pageSize, sort: { updatedAt: 'Ascending' } };
    if (after) opts.after = after;
    if (since) opts.filter = { updatedAt: { after: since } };
    const page = await manager.findMany(opts);
    for (const r of page) records.push(typeof r.toJSON === 'function' ? r.toJSON() : { ...r });
    onPage(records.length);
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  return records;
}

// Models can be namespaced in Gadget: "billing.invoice" → api.billing.invoice
export function modelManager(api, model) {
  const m = model.split('.').reduce((o, k) => o?.[k], api);
  if (!m || typeof m.findMany !== 'function') throw new Error(`No model "${model}" on this client. Check the API identifier.`);
  return m;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.client || !a.models) {
    console.error('usage: GADGET_API_KEY=gsk-... node scripts/gadget/export.mjs --client @gadget-client/<app> --models a,b [--env production] [--out export/] [--since ISO]');
    process.exit(2);
  }
  if (!process.env.GADGET_API_KEY) { console.error('Set GADGET_API_KEY (Settings → API Keys in Gadget; give it a read-only role).'); process.exit(2); }
  const mod = await import(a.client);
  // The generated client class is exported under the app's name (e.g. ExampleAppClient), and as Client.
  const Client = mod.Client || Object.values(mod).find((v) => typeof v === 'function' && /Client$/.test(v.name));
  if (!Client) throw new Error(`No client class exported by ${a.client}`);
  const api = new Client({ environment: a.env || 'production', authenticationMode: { apiKey: process.env.GADGET_API_KEY } });

  const outDir = a.out || 'export';
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { client: a.client, environment: a.env || 'production', since: a.since || null, exported_at: new Date().toISOString(), models: {} };
  for (const model of a.models.split(',').map((s) => s.trim()).filter(Boolean)) {
    process.stdout.write(`${model}: `);
    const records = await exportModel(modelManager(api, model), { since: a.since, onPage: (n) => process.stdout.write(`\r${model}: ${n}`) });
    const file = path.join(outDir, `${model}.ndjson`);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
    manifest.models[model] = { count: records.length, file: path.basename(file) };
    process.stdout.write(`\r${model}: ${records.length} records → ${file}\n`);
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`manifest → ${path.join(outDir, 'manifest.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
