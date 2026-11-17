#!/usr/bin/env node
// Load a Gadget export into Postgres staging tables, one per model: gadget_import_<model>(id, data jsonb, ...).
// Idempotent: re-running (e.g. with a --since delta export) upserts by id, so the final delta before
// cutover is just "export --since, then load again".
//
//   DATABASE_URL=postgres://... node scripts/gadget/load-postgres.mjs export/
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

export function tableFor(model) {
  const t = `gadget_import_${model.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(t)) throw new Error(`Unsafe table name for model ${model}`);
  return t;
}

// Shared with the schema dictionary, which documents this table shape.
export function stagingDdl(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (
      id          text PRIMARY KEY,
      data        jsonb NOT NULL,
      updated_at  timestamptz,
      imported_at timestamptz NOT NULL DEFAULT now()
    )`;
}

export async function loadExport(sql, dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const summary = {};
  for (const [model, { file }] of Object.entries(manifest.models)) {
    const table = tableFor(model);
    await sql.unsafe(stagingDdl(table));
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);
    let n = 0;
    for (let i = 0; i < lines.length; i += 500) {
      const rows = lines.slice(i, i + 500).map((l) => {
        const r = JSON.parse(l);
        if (r.id == null) throw new Error(`${model}: record without id`);
        return { id: String(r.id), data: r, updated_at: r.updatedAt || null };
      });
      await sql`
        INSERT INTO ${sql(table)} ${sql(rows.map((r) => ({ ...r, data: sql.json(r.data) })), 'id', 'data', 'updated_at')}
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, imported_at = now()`;
      n += rows.length;
    }
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${sql(table)}`;
    summary[model] = { table, loaded: n, total: count };
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'export';
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(2); }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  loadExport(sql, dir)
    .then((s) => { for (const [m, r] of Object.entries(s)) console.log(`${m}: ${r.loaded} loaded → ${r.table} (${r.total} rows total)`); })
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => sql.end());
}
