import { db, toNumber } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { LIMITS } from '../config.js';

const KINDS = new Set(['expense', 'income']);

function mapCategory(row) {
  return {
    id: toNumber(row.id),
    name: row.name,
    kind: row.kind,
    emoji: row.emoji,
    color: row.color,
    icon: row.icon,
    keywords: String(row.keywords || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    archived: row.archived,
    sort: toNumber(row.sort),
  };
}

export async function listCategories({ includeArchived = false, kind } = {}) {
  const params = [];
  const where = [];
  if (!includeArchived) where.push('archived = FALSE');
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT * FROM categories ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort, id`,
    params,
  );
  return rows.map(mapCategory);
}

export async function getCategory(id) {
  const { rows } = await db.query('SELECT * FROM categories WHERE id = $1', [id]);
  return rows.length > 0 ? mapCategory(rows[0]) : null;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) value = value.join(',');
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 60)
    .join(',');
}

export async function createCategory(input) {
  const name = String(input.name || '').trim();
  if (!name) throw badRequest('Nama kategori wajib diisi');
  if (name.length > LIMITS.name) throw badRequest(`Nama kategori maksimal ${LIMITS.name} karakter`);
  const kind = String(input.kind || 'expense');
  if (!KINDS.has(kind)) throw badRequest('Jenis kategori tidak valid');
  const color = String(input.color || '#64748b');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw badRequest('Warna tidak valid');
  const icon = String(input.icon || 'tag');
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(icon)) throw badRequest('Ikon kategori tidak valid');
  const keywords = normalizeKeywords(input.keywords);

  const { rows } = await db.query(
    `INSERT INTO categories (name, kind, icon, color, keywords, sort)
     VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories WHERE kind = $2))
     RETURNING id`,
    [name, kind, icon, color, keywords],
  );
  return getCategory(rows[0].id);
}

export async function updateCategory(id, input) {
  const current = await getCategory(id);
  if (!current) throw notFound('Kategori tidak ditemukan');
  const name = String(input.name ?? current.name).trim();
  if (!name) throw badRequest('Nama kategori wajib diisi');
  const kind = String(input.kind ?? current.kind);
  if (!KINDS.has(kind)) throw badRequest('Jenis kategori tidak valid');
  if (kind !== current.kind) {
    const used = await db.query('SELECT count(*)::int AS c FROM transactions WHERE category_id = $1', [id]);
    if (used.rows[0].c > 0) throw badRequest('Jenis kategori tidak bisa diubah karena sudah dipakai transaksi');
  }
  const icon = String(input.icon ?? current.icon);
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(icon)) throw badRequest('Ikon kategori tidak valid');
  const color = String(input.color ?? current.color);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw badRequest('Warna tidak valid');
  const keywords = input.keywords !== undefined ? normalizeKeywords(input.keywords) : current.keywords.join(',');

  await db.query(
    `UPDATE categories SET name = $1, kind = $2, icon = $3, color = $4, keywords = $5 WHERE id = $6`,
    [name, kind, icon, color, keywords, id],
  );
  return getCategory(id);
}

export async function archiveCategory(id) {
  const current = await getCategory(id);
  if (!current) throw notFound('Kategori tidak ditemukan');
  await db.query('UPDATE categories SET archived = TRUE WHERE id = $1', [id]);
  return { ok: true };
}

export async function restoreCategory(id) {
  const current = await getCategory(id);
  if (!current) throw notFound('Kategori tidak ditemukan');
  await db.query('UPDATE categories SET archived = FALSE WHERE id = $1', [id]);
  return getCategory(id);
}

export function matchCategory(categories, text, kind) {
  const haystack = ` ${String(text || '').toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  for (const category of categories) {
    if (category.kind !== kind) continue;
    for (const keyword of category.keywords) {
      if (keyword.length < 3) continue;
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (re.test(haystack) && keyword.length > bestScore) {
        best = category;
        bestScore = keyword.length;
      }
    }
  }
  return best;
}

export async function fallbackCategory(kind) {
  const { rows } = await db.query(
    `SELECT * FROM categories WHERE kind = $1 AND archived = FALSE
     ORDER BY (name ILIKE '%lain%') DESC, sort, id LIMIT 1`,
    [kind],
  );
  return rows.length > 0 ? mapCategory(rows[0]) : null;
}
