import type { Env } from './types';

/** Compute deduplicated R2 bytes used by a single user across all uploaded assets. */
export async function getUserUsedBytes(db: D1Database, ownerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total
       FROM (
         SELECT r2_key, MAX(size_bytes) AS size_bytes
         FROM assets
         WHERE owner_id = ? AND uploaded = 1
         GROUP BY r2_key
       )`,
    )
    .bind(ownerId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/** Delete R2 keys that are no longer referenced by any row in `assets`. */
export async function gcR2Keys(env: Env, keys: string[]): Promise<number> {
  const unique = [...new Set(keys.filter(Boolean))];
  let deleted = 0;
  for (const key of unique) {
    const ref = await env.DB.prepare('SELECT 1 AS ok FROM assets WHERE r2_key = ? LIMIT 1')
      .bind(key)
      .first<{ ok: number }>();
    if (!ref) {
      await env.BUCKET.delete(key);
      deleted++;
    }
  }
  return deleted;
}

/** Delete a project row and garbage-collect any unreferenced R2 asset blobs + thumbnail. */
export async function deleteProjectWithAssets(env: Env, projectId: string): Promise<boolean> {
  const proj = await env.DB.prepare('SELECT id, thumbnail_key FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string; thumbnail_key: string | null }>();
  if (!proj) return false;

  const assetRows = await env.DB.prepare('SELECT r2_key FROM assets WHERE project_id = ?')
    .bind(projectId)
    .all<{ r2_key: string }>();
  const r2Keys = (assetRows.results ?? []).map((r) => r.r2_key);

  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();

  if (proj.thumbnail_key) {
    await env.BUCKET.delete(proj.thumbnail_key);
  }
  if (r2Keys.length > 0) {
    await gcR2Keys(env, r2Keys);
  }
  return true;
}

/** Delete a user and clean up all their R2 thumbnails and unreferenced assets. */
export async function deleteUserWithAssets(env: Env, userId: string): Promise<boolean> {
  const thumbs = await env.DB.prepare(
    'SELECT thumbnail_key FROM projects WHERE owner_id = ? AND thumbnail_key IS NOT NULL',
  )
    .bind(userId)
    .all<{ thumbnail_key: string }>();
  const assets = await env.DB.prepare('SELECT DISTINCT r2_key FROM assets WHERE owner_id = ?')
    .bind(userId)
    .all<{ r2_key: string }>();

  const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  if ((res.meta?.changes ?? 0) === 0) return false;

  for (const row of thumbs.results ?? []) {
    if (row.thumbnail_key) await env.BUCKET.delete(row.thumbnail_key);
  }
  if ((assets.results ?? []).length > 0) {
    await gcR2Keys(
      env,
      (assets.results ?? []).map((r) => r.r2_key),
    );
  }
  return true;
}

export function assetR2Key(ownerId: string, sha256: string): string {
  return `assets/${ownerId}/${sha256}`;
}

export function thumbR2Key(projectId: string): string {
  return `thumbs/${projectId}.webp`;
}
