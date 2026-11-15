import { db } from '../db/index.js';

export async function getSetting(key, fallback = null) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length > 0 ? rows[0].value : fallback;
}

export async function setSetting(key, value) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)],
  );
}

export async function deleteSetting(key) {
  await db.query('DELETE FROM settings WHERE key = $1', [key]);
}

export async function getOwnerChatId() {
  return getSetting('owner_chat_id', null);
}

export async function getAllowedChatIds() {
  const owner = await getOwnerChatId();
  const extra = (await getSetting('allowed_chat_ids', '')) || '';
  const ids = extra.split(',').map((s) => s.trim()).filter(Boolean);
  if (owner) ids.unshift(String(owner));
  return [...new Set(ids)];
}

export async function getDefaultAccountId() {
  const value = await getSetting('default_account_id', null);
  return value ? Number(value) : null;
}

export async function setDefaultAccountId(id) {
  await setSetting('default_account_id', id);
}
