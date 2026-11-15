import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, 'schema.sql');

let pgPool = null;
let pglite = null;

function isLocalDatabase(url) {
  return /localhost|127\.0\.0\.1|@\/|pglite/i.test(url);
}

async function connect() {
  if (config.databaseUrl) {
    pgPool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      ssl: isLocalDatabase(config.databaseUrl) ? false : { rejectUnauthorized: false },
    });
    pgPool.on('error', (err) => console.error('[db] pool error:', err.message));
    await pgPool.query('SELECT 1');
    console.log('[db] terhubung ke Postgres');
    return;
  }

  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), 'data', 'pglite');
  await fs.mkdir(dir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  pglite = await PGlite.create(dir);
  console.log(`[db] mode lokal (PGlite) di ${dir}`);
}

export const db = {
  async query(sql, params = []) {
    if (pgPool) return pgPool.query(sql, params);
    return pglite.query(sql, params);
  },

  async exec(sql) {
    if (pgPool) return pgPool.query(sql);
    return pglite.exec(sql);
  },

  async withTx(fn) {
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params = []) => client.query(sql, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    await pglite.query('BEGIN');
    try {
      const result = await fn({ query: (sql, params = []) => pglite.query(sql, params) });
      await pglite.query('COMMIT');
      return result;
    } catch (err) {
      await pglite.query('ROLLBACK').catch(() => {});
      throw err;
    }
  },
};

export async function initDb() {
  await connect();
  const schema = await fs.readFile(schemaPath, 'utf8');
  await db.exec(schema);
}

export function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function rowToTransaction(row) {
  if (!row) return null;
  return {
    id: toNumber(row.id),
    kind: row.kind,
    amount: toNumber(row.amount),
    accountId: toNumber(row.account_id),
    toAccountId: row.to_account_id === null ? null : toNumber(row.to_account_id),
    categoryId: row.category_id === null ? null : toNumber(row.category_id),
    note: row.note || '',
    occurredOn: typeof row.occurred_on === 'string' ? row.occurred_on.slice(0, 10) : toDateISO(row.occurred_on),
    source: row.source,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    accountName: row.account_name ?? undefined,
    accountIcon: row.account_icon ?? undefined,
    toAccountName: row.to_account_name ?? undefined,
    categoryName: row.category_name ?? null,
    categoryIcon: row.category_icon ?? null,
    categoryColor: row.category_color ?? null,
  };
}

function toDateISO(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(value);
  }
  return String(value).slice(0, 10);
}
