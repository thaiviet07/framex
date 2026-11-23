import { Hono } from 'hono';
import { logAudit, requireAuth } from '../auth';
import { randomId, randomToken, sha256Hex } from '../crypto';
import { getAppSettings } from '../settings';
import {
  assetR2Key,
  deleteProjectWithAssets,
  gcR2Keys,
  getUserUsedBytes,
  thumbR2Key,
} from '../storage';
import type {
  AppEnv,
  AssetRow,
  ProjectRow,
  ProjectStatus,
  ProjectVersionRow,
  ProjectVisibility,
} from '../types';

const MAX_ASSET_BYTES = 40 * 1024 * 1024; // 40 MB per asset
const MAX_THUMB_BYTES = 2 * 1024 * 1024; // 2 MB per thumbnail

interface AssetManifestItem {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

type ProjectWithOwnerRow = ProjectRow & {
  owner_name?: string;
  owner_email?: string;
};

function canReadProject(proj: { owner_id: string; visibility?: string }, user: { id: string; role: string }): boolean {
  return proj.owner_id === user.id || user.role === 'admin' || (proj.visibility ?? 'team') === 'team';
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().slice(0, 32);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeStatus(v: unknown, fallback: ProjectStatus = 'draft'): ProjectStatus {
  return v === 'draft' || v === 'review' || v === 'approved' ? v : fallback;
}

function serializeProjectSummary(row: ProjectWithOwnerRow, viewerId?: string) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    ownerEmail: row.owner_email ?? null,
    isOwner: viewerId ? row.owner_id === viewerId : false,
    name: row.name,
    visibility: (row.visibility === 'private' ? 'private' : 'team') as ProjectVisibility,
    status: normalizeStatus(row.status, 'draft'),
    tags: parseTags(row.tags),
    notes: row.notes ?? '',
    hasThumbnail: Boolean(row.thumbnail_key),
    thumbnailUrl: row.thumbnail_key ? `/api/projects/${row.id}/thumbnail?v=${row.updated_at}` : null,
    assetCount: row.asset_count,
    totalBytes: row.total_bytes,
    version: row.version,
    shareEnabled: row.share_enabled === 1,
    shareToken: row.share_enabled === 1 ? row.share_token : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const projectRoutes = new Hono<AppEnv>();

// ---------------- Authenticated User Project Routes ----------------

projectRoutes.get('/projects', requireAuth, async (c) => {
  const user = c.get('user')!;
  const rows = await c.env.DB.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
     FROM projects p
     JOIN users u ON u.id = p.owner_id
     WHERE p.owner_id = ? OR p.visibility = 'team'
     ORDER BY p.updated_at DESC`,
  )
    .bind(user.id)
    .all<ProjectWithOwnerRow>();

  const usedBytes = await getUserUsedBytes(c.env.DB, user.id);
  return c.json({
    projects: (rows.results ?? []).map((r) => serializeProjectSummary(r, user.id)),
    usedBytes,
    quotaBytes: user.quotaBytes,
  });
});

projectRoutes.post('/projects', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req
    .json<{
      id?: string;
      name?: string;
      visibility?: ProjectVisibility;
      status?: ProjectStatus;
      tags?: string[];
      notes?: string;
      versionNote?: string;
      project?: Record<string, unknown>;
      assets?: AssetManifestItem[];
    }>()
    .catch(() => null);

  if (!body || !body.project || typeof body.project !== 'object') {
    return c.json({ error: 'Dữ liệu project không hợp lệ' }, 400);
  }

  const settings = await getAppSettings(c.env);
  const name = (body.name ?? (body.project.name as string) ?? 'FX Card').trim().slice(0, 120) || 'FX Card';
  const manifest = Array.isArray(body.assets) ? body.assets : [];
  const dataJson = JSON.stringify(body.project);
  const now = Date.now();

  let projectId = body.id?.trim() || '';
  let existing: ProjectRow | null = null;
  if (projectId) {
    existing = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
    if (existing && existing.owner_id !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Bạn không có quyền ghi đè project của người khác (hãy dùng "Lưu bản mới")' }, 403);
    }
  }
  if (!existing) {
    projectId = randomId('prj');
  }

  const ownerId = existing ? existing.owner_id : user.id;
  const visibility: ProjectVisibility =
    body.visibility === 'private' || body.visibility === 'team'
      ? body.visibility
      : existing
        ? existing.visibility === 'private'
          ? 'private'
          : 'team'
        : settings.defaultVisibility;
  const status: ProjectStatus = normalizeStatus(
    body.status,
    existing ? normalizeStatus(existing.status, 'draft') : 'draft',
  );
  const tagsJson = JSON.stringify(
    body.tags !== undefined ? normalizeTags(body.tags) : existing ? parseTags(existing.tags) : [],
  );
  const notes =
    typeof body.notes === 'string'
      ? body.notes.trim().slice(0, 2000)
      : existing
        ? (existing.notes ?? '')
        : '';

  // Check which SHA-256 blobs are already uploaded in R2 for this owner (and verify in R2)
  const existingShaRows = await c.env.DB.prepare(
    'SELECT DISTINCT sha256 FROM assets WHERE owner_id = ? AND uploaded = 1',
  )
    .bind(ownerId)
    .all<{ sha256: string }>();
  const dbShas = new Set((existingShaRows.results ?? []).map((r) => r.sha256));
  const knownShas = new Set<string>();

  for (const item of manifest) {
    if (!item.id || !item.sha256 || !dbShas.has(item.sha256) || knownShas.has(item.sha256)) continue;
    const head = await c.env.BUCKET.head(assetR2Key(ownerId, item.sha256));
    if (head) {
      knownShas.add(item.sha256);
    }
  }

  // Estimate incremental bytes needed for new SHA-256 blobs
  const newShasSeen = new Set<string>();
  let newBytes = 0;
  for (const item of manifest) {
    if (!item.id || !item.sha256) continue;
    if (item.sizeBytes > MAX_ASSET_BYTES) {
      return c.json({ error: `Asset "${item.name}" vượt quá giới hạn 40 MB` }, 413);
    }
    if (!knownShas.has(item.sha256) && !newShasSeen.has(item.sha256)) {
      newShasSeen.add(item.sha256);
      newBytes += Math.max(0, Number(item.sizeBytes) || 0);
    }
  }

  const currentUsed = await getUserUsedBytes(c.env.DB, ownerId);
  if (currentUsed + newBytes > user.quotaBytes && user.role !== 'admin') {
    return c.json(
      {
        error: 'Vượt quá hạn mức dung lượng lưu trữ của tài khoản',
        usedBytes: currentUsed,
        quotaBytes: user.quotaBytes,
        requiredBytes: newBytes,
      },
      413,
    );
  }

  const totalProjectBytes = manifest.reduce((sum, a) => sum + Math.max(0, Number(a.sizeBytes) || 0), 0);

  const nextVersion = existing ? existing.version + 1 : 1;

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE projects
       SET name = ?, data_json = ?, visibility = ?, status = ?, tags = ?, notes = ?, asset_count = ?, total_bytes = ?, version = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(name, dataJson, visibility, status, tagsJson, notes, manifest.length, totalProjectBytes, nextVersion, now, projectId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, data_json, visibility, status, tags, notes, asset_count, total_bytes, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(projectId, ownerId, name, dataJson, visibility, status, tagsJson, notes, manifest.length, totalProjectBytes, now, now)
      .run();
  }

  // Record lightweight snapshot in project_versions & trim beyond maxVersionsPerProject
  try {
    const verNote = typeof body.versionNote === 'string' ? body.versionNote.trim().slice(0, 200) : '';
    await c.env.DB.prepare(
      `INSERT INTO project_versions (id, project_id, version, name, data_json, asset_manifest_json, saved_by, saved_by_name, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        randomId('ver'),
        projectId,
        nextVersion,
        name,
        dataJson,
        JSON.stringify(manifest.map(({ id, name: n, type, width, height, sizeBytes, sha256 }) => ({ id, name: n, type, width, height, sizeBytes, sha256 }))),
        user.id,
        user.name,
        verNote,
        now,
      )
      .run();

    await c.env.DB.prepare(
      `DELETE FROM project_versions
       WHERE project_id = ? AND id NOT IN (
         SELECT id FROM project_versions WHERE project_id = ? ORDER BY version DESC LIMIT ?
       )`,
    )
      .bind(projectId, projectId, settings.maxVersionsPerProject)
      .run();
  } catch {
    // Non-fatal if migration hasn't run yet
  }

  // Reconcile project assets: find removed ones for R2 GC
  const prevAssets = await c.env.DB.prepare('SELECT asset_id, r2_key FROM assets WHERE project_id = ?')
    .bind(projectId)
    .all<{ asset_id: string; r2_key: string }>();
  const wantedIds = new Set(manifest.map((a) => a.id));
  const removedKeys: string[] = [];
  for (const prev of prevAssets.results ?? []) {
    if (!wantedIds.has(prev.asset_id)) {
      removedKeys.push(prev.r2_key);
      await c.env.DB.prepare('DELETE FROM assets WHERE project_id = ? AND asset_id = ?')
        .bind(projectId, prev.asset_id)
        .run();
    }
  }

  const missingAssets: string[] = [];
  for (const item of manifest) {
    if (!item.id || !item.sha256) continue;
    const r2Key = assetR2Key(ownerId, item.sha256);
    const alreadyUploaded = knownShas.has(item.sha256) ? 1 : 0;
    if (!alreadyUploaded) {
      missingAssets.push(item.id);
    }
    await c.env.DB.prepare(
      `INSERT INTO assets (id, project_id, owner_id, asset_id, name, mime_type, width, height, size_bytes, sha256, r2_key, uploaded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, asset_id) DO UPDATE SET
         name = excluded.name,
         mime_type = excluded.mime_type,
         width = excluded.width,
         height = excluded.height,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256,
         r2_key = excluded.r2_key,
         uploaded = CASE WHEN excluded.uploaded = 1 THEN 1 ELSE assets.uploaded END`,
    )
      .bind(
        `${projectId}:${item.id}`,
        projectId,
        ownerId,
        item.id,
        item.name || item.id,
        item.type || 'application/octet-stream',
        Math.max(0, Number(item.width) || 0),
        Math.max(0, Number(item.height) || 0),
        Math.max(0, Number(item.sizeBytes) || 0),
        item.sha256,
        r2Key,
        alreadyUploaded,
        now,
      )
      .run();
  }

  if (removedKeys.length > 0) {
    await gcR2Keys(c.env, removedKeys);
  }

  const saved = await c.env.DB.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
     FROM projects p JOIN users u ON u.id = p.owner_id
     WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<ProjectWithOwnerRow>();
  await logAudit(c, existing ? 'project.update' : 'project.create', 'project', projectId, {
    name,
    visibility,
    assetCount: manifest.length,
    missingUploads: missingAssets.length,
  });

  return c.json({
    project: saved ? serializeProjectSummary(saved, user.id) : null,
    missingAssets,
  });
});

projectRoutes.put('/projects/:id/assets/:assetId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const assetId = c.req.param('assetId')!;

  const proj = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const assetRow = await c.env.DB.prepare('SELECT * FROM assets WHERE project_id = ? AND asset_id = ?')
    .bind(projectId, assetId)
    .first<AssetRow>();
  if (!assetRow) {
    return c.json({ error: 'Asset chưa được khai báo trong manifest project' }, 404);
  }

  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_ASSET_BYTES) {
    return c.json({ error: 'Asset vượt quá giới hạn 40 MB' }, 413);
  }

  const actualSha = await sha256Hex(buf);
  const r2Key = assetR2Key(proj.owner_id, actualSha);
  const contentType = c.req.header('content-type') || assetRow.mime_type || 'application/octet-stream';

  await c.env.BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType },
    customMetadata: {
      ownerId: proj.owner_id,
      sha256: actualSha,
    },
  });

  await c.env.DB.prepare(
    `UPDATE assets
     SET sha256 = ?, r2_key = ?, size_bytes = ?, uploaded = 1
     WHERE owner_id = ? AND (id = ? OR sha256 = ?)`,
  )
    .bind(actualSha, r2Key, buf.byteLength, proj.owner_id, assetRow.id, actualSha)
    .run();

  return c.json({ ok: true, assetId, sha256: actualSha, sizeBytes: buf.byteLength });
});

projectRoutes.put('/projects/:id/thumbnail', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;

  const proj = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_THUMB_BYTES) {
    return c.json({ error: 'Thumbnail không hợp lệ (tối đa 2 MB)' }, 400);
  }

  const key = thumbR2Key(projectId);
  const contentType = c.req.header('content-type') || 'image/webp';
  await c.env.BUCKET.put(key, buf, {
    httpMetadata: { contentType },
  });

  const now = Date.now();
  await c.env.DB.prepare('UPDATE projects SET thumbnail_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, now, projectId)
    .run();

  return c.json({ ok: true, thumbnailUrl: `/api/projects/${projectId}/thumbnail?v=${now}` });
});

projectRoutes.get('/projects/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;

  const proj = await c.env.DB.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
     FROM projects p JOIN users u ON u.id = p.owner_id
     WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<ProjectWithOwnerRow>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (!canReadProject(proj, user)) {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const assetRows = await c.env.DB.prepare('SELECT * FROM assets WHERE project_id = ?')
    .bind(projectId)
    .all<AssetRow>();

  return c.json({
    meta: serializeProjectSummary(proj, user.id),
    project: JSON.parse(proj.data_json),
    assets: (assetRows.results ?? []).map((a) => ({
      id: a.asset_id,
      name: a.name,
      type: a.mime_type,
      width: a.width,
      height: a.height,
      sizeBytes: a.size_bytes,
      sha256: a.sha256,
      uploaded: a.uploaded === 1,
      url: `/api/projects/${projectId}/assets/${encodeURIComponent(a.asset_id)}`,
    })),
  });
});

projectRoutes.get('/projects/:id/assets/:assetId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const assetId = c.req.param('assetId')!;

  const proj = await c.env.DB.prepare('SELECT owner_id, visibility FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; visibility: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (!canReadProject(proj, user)) {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const assetRow = await c.env.DB.prepare('SELECT r2_key, mime_type FROM assets WHERE project_id = ? AND asset_id = ?')
    .bind(projectId, assetId)
    .first<{ r2_key: string; mime_type: string }>();
  if (!assetRow) return c.json({ error: 'Không tìm thấy asset' }, 404);

  const obj = await c.env.BUCKET.get(assetRow.r2_key);
  if (!obj) return c.json({ error: 'Asset chưa tồn tại trên R2' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || assetRow.mime_type || 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
});

projectRoutes.get('/projects/:id/thumbnail', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;

  const proj = await c.env.DB.prepare('SELECT owner_id, visibility, thumbnail_key FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; visibility: string; thumbnail_key: string | null }>();
  if (!proj?.thumbnail_key) return c.notFound();
  if (!canReadProject(proj, user)) {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const obj = await c.env.BUCKET.get(proj.thumbnail_key);
  if (!obj) return c.notFound();

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/webp');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
});

projectRoutes.patch('/projects/:id/visibility', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const body = await c.req
    .json<{ visibility?: ProjectVisibility }>()
    .catch(() => ({}) as { visibility?: ProjectVisibility });

  if (body.visibility !== 'team' && body.visibility !== 'private') {
    return c.json({ error: 'Giá trị visibility phải là "team" hoặc "private"' }, 400);
  }

  const proj = await c.env.DB.prepare('SELECT owner_id, name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; name: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Chỉ chủ sở hữu hoặc Admin mới đổi được quyền hiển thị' }, 403);
  }

  await c.env.DB.prepare('UPDATE projects SET visibility = ?, updated_at = ? WHERE id = ?')
    .bind(body.visibility, Date.now(), projectId)
    .run();

  await logAudit(c, 'project.visibility', 'project', projectId, { name: proj.name, visibility: body.visibility });
  return c.json({ ok: true, visibility: body.visibility });
});

projectRoutes.patch('/projects/:id/meta', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const body = await c.req
    .json<{
      name?: string;
      status?: ProjectStatus;
      tags?: string[];
      notes?: string;
      visibility?: ProjectVisibility;
    }>()
    .catch(
      () =>
        ({}) as {
          name?: string;
          status?: ProjectStatus;
          tags?: string[];
          notes?: string;
          visibility?: ProjectVisibility;
        },
    );

  const proj = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Chỉ chủ sở hữu hoặc Admin mới sửa được thông tin dự án' }, 403);
  }

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('name = ?');
    binds.push(body.name.trim().slice(0, 120));
  }
  if (body.status === 'draft' || body.status === 'review' || body.status === 'approved') {
    updates.push('status = ?');
    binds.push(body.status);
  }
  if (body.tags !== undefined) {
    updates.push('tags = ?');
    binds.push(JSON.stringify(normalizeTags(body.tags)));
  }
  if (typeof body.notes === 'string') {
    updates.push('notes = ?');
    binds.push(body.notes.trim().slice(0, 2000));
  }
  if (body.visibility === 'team' || body.visibility === 'private') {
    updates.push('visibility = ?');
    binds.push(body.visibility);
  }

  if (updates.length === 0) return c.json({ error: 'Không có thay đổi nào' }, 400);
  updates.push('updated_at = ?');
  binds.push(Date.now(), projectId);

  await c.env.DB.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  await logAudit(c, 'project.meta', 'project', projectId, { fields: Object.keys(body) });

  const updated = await c.env.DB.prepare(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
     FROM projects p JOIN users u ON u.id = p.owner_id
     WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<ProjectWithOwnerRow>();

  return c.json({ project: updated ? serializeProjectSummary(updated, user.id) : null });
});

projectRoutes.get('/projects/:id/versions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;

  const proj = await c.env.DB.prepare('SELECT owner_id, visibility FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; visibility: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (!canReadProject(proj, user)) {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, version, name, saved_by_name AS savedByName, note, created_at AS createdAt
     FROM project_versions
     WHERE project_id = ?
     ORDER BY version DESC
     LIMIT 50`,
  )
    .bind(projectId)
    .all();

  return c.json({ versions: rows.results ?? [] });
});

projectRoutes.get('/projects/:id/versions/:versionId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const versionId = c.req.param('versionId')!;

  const proj = await c.env.DB.prepare('SELECT owner_id, visibility FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; visibility: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (!canReadProject(proj, user)) {
    return c.json({ error: 'Không có quyền truy cập' }, 403);
  }

  const ver = await c.env.DB.prepare('SELECT * FROM project_versions WHERE id = ? AND project_id = ?')
    .bind(versionId, projectId)
    .first<ProjectVersionRow>();
  if (!ver) return c.json({ error: 'Không tìm thấy phiên bản' }, 404);

  const manifest = JSON.parse(ver.asset_manifest_json || '[]') as AssetManifestItem[];
  return c.json({
    version: {
      id: ver.id,
      version: ver.version,
      name: ver.name,
      savedByName: ver.saved_by_name,
      note: ver.note,
      createdAt: ver.created_at,
    },
    project: JSON.parse(ver.data_json),
    assets: manifest.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      width: a.width,
      height: a.height,
      sizeBytes: a.sizeBytes,
      url: `/api/projects/${projectId}/assets/${encodeURIComponent(a.id)}`,
    })),
  });
});

projectRoutes.post('/projects/:id/share', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;
  const body = await c.req
    .json<{ enabled?: boolean; regenerate?: boolean }>()
    .catch(() => ({}) as { enabled?: boolean; regenerate?: boolean });

  const proj = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Không có quyền chia sẻ project này' }, 403);
  }

  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : proj.share_enabled !== 1;
  if (enabled) {
    const settings = await getAppSettings(c.env);
    if (!settings.allowPublicShare) {
      return c.json({ error: 'Quản trị viên đã tắt tính năng tạo link chia sẻ công khai' }, 403);
    }
  }
  let token = proj.share_token;
  if (enabled && (!token || body.regenerate)) {
    token = randomToken(16);
  }

  await c.env.DB.prepare('UPDATE projects SET share_enabled = ?, share_token = ?, updated_at = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, token, Date.now(), projectId)
    .run();

  await logAudit(c, 'project.share', 'project', projectId, { enabled, regenerated: Boolean(body.regenerate) });

  const origin = new URL(c.req.url).origin;
  return c.json({
    shareEnabled: enabled,
    shareToken: enabled ? token : null,
    shareUrl: enabled && token ? `${origin}/share/${token}` : null,
  });
});

projectRoutes.delete('/projects/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const projectId = c.req.param('id')!;

  const proj = await c.env.DB.prepare('SELECT owner_id, name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ owner_id: string; name: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);
  if (proj.owner_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Không có quyền xóa project này' }, 403);
  }

  await deleteProjectWithAssets(c.env, projectId);
  await logAudit(c, 'project.delete', 'project', projectId, { name: proj.name });
  return c.json({ ok: true });
});

// ---------------- Public Read-Only Share Routes ----------------

projectRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  const proj = await c.env.DB.prepare(
    `SELECT p.*, u.name AS owner_name
     FROM projects p
     JOIN users u ON u.id = p.owner_id
     WHERE p.share_token = ? AND p.share_enabled = 1`,
  )
    .bind(token)
    .first<ProjectRow & { owner_name: string }>();

  if (!proj) {
    return c.json({ error: 'Liên kết chia sẻ không tồn tại hoặc đã bị tắt' }, 404);
  }

  const assetRows = await c.env.DB.prepare('SELECT * FROM assets WHERE project_id = ? AND uploaded = 1')
    .bind(proj.id)
    .all<AssetRow>();

  return c.json({
    meta: {
      id: proj.id,
      name: proj.name,
      ownerName: proj.owner_name,
      updatedAt: proj.updated_at,
      version: proj.version,
    },
    project: JSON.parse(proj.data_json),
    assets: (assetRows.results ?? []).map((a) => ({
      id: a.asset_id,
      name: a.name,
      type: a.mime_type,
      width: a.width,
      height: a.height,
      sizeBytes: a.size_bytes,
      url: `/api/share/${encodeURIComponent(token)}/assets/${encodeURIComponent(a.asset_id)}`,
    })),
  });
});

projectRoutes.get('/share/:token/assets/:assetId', async (c) => {
  const token = c.req.param('token');
  const assetId = c.req.param('assetId')!;

  const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE share_token = ? AND share_enabled = 1')
    .bind(token)
    .first<{ id: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy' }, 404);

  const assetRow = await c.env.DB.prepare('SELECT r2_key, mime_type FROM assets WHERE project_id = ? AND asset_id = ?')
    .bind(proj.id, assetId)
    .first<{ r2_key: string; mime_type: string }>();
  if (!assetRow) return c.json({ error: 'Không tìm thấy asset' }, 404);

  const obj = await c.env.BUCKET.get(assetRow.r2_key);
  if (!obj) return c.json({ error: 'Asset không tồn tại trên R2' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || assetRow.mime_type || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
});
