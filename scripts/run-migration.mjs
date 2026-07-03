// scripts/run-migration.mjs — run a .sql file against POSTGRES_URL.
// Usage: POSTGRES_URL=... node scripts/run-migration.mjs scripts/migrate-hooklab.sql
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/run-migration.mjs <file.sql>'); process.exit(1); }
if (!process.env.POSTGRES_URL) { console.error('POSTGRES_URL not set'); process.exit(1); }

const sql = neon(process.env.POSTGRES_URL);
const raw = readFileSync(file, 'utf8');
// naive statement splitter: fine for our DDL (no functions/procedures)
const statements = raw
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.replace(/^--.*$/gm, '').trim())
  .filter(Boolean);

for (const stmt of statements) {
  console.log('>', stmt.split('\n')[0].slice(0, 80));
  await sql.query(stmt);
}
console.log(`Done: ${statements.length} statements.`);
