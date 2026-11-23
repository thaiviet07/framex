import { Hono } from 'hono';
import { logAudit, requireAdmin } from '../auth';
import { hashPassword, randomId } from '../crypto';
import { getAppSettings, updateAppSettings } from '../settings';
import { cleanOrphanR2Objects, deleteProjectWithAssets, deleteUserWithAssets } from '../storage';
import type { AppEnv, ProjectStatus, ProjectVisibility, UserRole, UserStatus } from '../types';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAdmin);

adminRoutes.get('/overview', async (c) => {
  const [userStats, projectStats, r2Stats, topUsers, recentLogs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS totalUsers,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeUsers,
         SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabledUsers,
         SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS adminUsers,
         COALESCE(SUM(quota_bytes), 0) AS totalQuotaBytes
       FROM users`,
    ).first<{
      totalUsers: number;
      activeUsers: number;
      disabledUsers: number;
      adminUsers: number;
      totalQuotaBytes: number;
    }>(),

    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS totalProjects,
         SUM(CASE WHEN share_enabled = 1 THEN 1 ELSE 0 END) AS sharedProjects,
         SUM(CASE WHEN visibility = 'private' THEN 1 ELSE 0 END) AS privateProjects,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draftProjects,
         SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS reviewProjects,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approvedProjects,
         COALESCE(SUM(asset_count), 0) AS totalAssetRefs
       FROM projects`,
    ).first<{
      totalProjects: number;
      sharedProjects: number;
      privateProjects: number;
      draftProjects: number;
      reviewProjects: number;
      approvedProjects: number;
      totalAssetRefs: number;
    }>(),

    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS uniqueObjects,
         COALESCE(SUM(size_bytes), 0) AS totalR2Bytes
       FROM (
         SELECT r2_key, MAX(size_bytes) AS size_bytes
         FROM assets
         WHERE uploaded = 1
         GROUP BY r2_key
       )`,
    ).first<{ uniqueObjects: number; totalR2Bytes: number }>(),

    c.env.DB.prepare(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.quota_bytes AS quotaBytes,
         (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS projectCount,
         COALESCE((
           SELECT SUM(s.size_bytes)
           FROM (
             SELECT r2_key, MAX(size_bytes) AS size_bytes
             FROM assets a
             WHERE a.owner_id = u.id AND a.uploaded = 1
             GROUP BY r2_key
           ) s
         ), 0) AS usedBytes
       FROM users u
       ORDER BY usedBytes DESC, projectCount DESC
       LIMIT 8`,
    ).all(),

    c.env.DB.prepare(
      `SELECT id, actor_email AS actorEmail, action, target_type AS targetType, target_id AS targetId, detail_json AS detailJson, ip, created_at AS createdAt
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 20`,
    ).all(),
  ]);

  const now = Date.now();
  const since7d = now - 7 * 24 * 60 * 60 * 1000;
  const since14d = now - 13 * 24 * 60 * 60 * 1000;
  const [recentActivityCount, raw14d] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM audit_logs WHERE created_at >= ?')
      .bind(since7d)
      .first<{ cnt: number }>(),
    c.env.DB.prepare(
      `SELECT action, created_at AS createdAt
       FROM audit_logs
       WHERE created_at >= ? AND action IN ('auth.login', 'project.create', 'project.update')`,
    )
      .bind(since14d)
      .all<{ action: string; createdAt: number }>(),
  ]);

  // Build 14 daily buckets (YYYY-MM-DD)
  const dayBuckets = new Map<string, { date: string; saves: number; logins: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dayBuckets.set(key, { date: key, saves: 0, logins: 0 });
  }
  for (const row of raw14d.results ?? []) {
    const key = new Date(row.createdAt).toISOString().slice(0, 10);
    const b = dayBuckets.get(key);
    if (!b) continue;
    if (row.action === 'auth.login') b.logins++;
    else b.saves++;
  }

  return c.json({
    stats: {
      totalUsers: Number(userStats?.totalUsers ?? 0),
      activeUsers: Number(userStats?.activeUsers ?? 0),
      disabledUsers: Number(userStats?.disabledUsers ?? 0),
      adminUsers: Number(userStats?.adminUsers ?? 0),
      totalQuotaBytes: Number(userStats?.totalQuotaBytes ?? 0),
      totalProjects: Number(projectStats?.totalProjects ?? 0),
      sharedProjects: Number(projectStats?.sharedProjects ?? 0),
      privateProjects: Number(projectStats?.privateProjects ?? 0),
      draftProjects: Number(projectStats?.draftProjects ?? 0),
      reviewProjects: Number(projectStats?.reviewProjects ?? 0),
      approvedProjects: Number(projectStats?.approvedProjects ?? 0),
      totalAssetRefs: Number(projectStats?.totalAssetRefs ?? 0),
      uniqueR2Objects: Number(r2Stats?.uniqueObjects ?? 0),
      totalR2Bytes: Number(r2Stats?.totalR2Bytes ?? 0),
      activity7d: Number(recentActivityCount?.cnt ?? 0),
    },
    activity14d: [...dayBuckets.values()],
    topUsers: topUsers.results ?? [],
    recentLogs: recentLogs.results ?? [],
  });
});

adminRoutes.get('/users', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.role,
       u.status,
       u.quota_bytes AS quotaBytes,
       u.created_at AS createdAt,
       u.updated_at AS updatedAt,
       u.last_login_at AS lastLoginAt,
       (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS projectCount,
       COALESCE((
         SELECT SUM(s.size_bytes)
         FROM (
           SELECT r2_key, MAX(size_bytes) AS size_bytes
           FROM assets a
           WHERE a.owner_id = u.id AND a.uploaded = 1
           GROUP BY r2_key
         ) s
       ), 0) AS usedBytes
     FROM users u
     ORDER BY u.created_at DESC`,
  ).all();

  return c.json({ users: rows.results ?? [] });
});

adminRoutes.post('/users', async (c) => {
  const body = await c.req
    .json<{
      email?: string;
      name?: string;
      password?: string;
      role?: UserRole;
      quotaMb?: number;
    }>()
    .catch(
      () =>
        ({}) as {
          email?: string;
          name?: string;
          password?: string;
          role?: UserRole;
          quotaMb?: number;
        },
    );

  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim();
  const password = body.password ?? '';
  const role: UserRole = body.role === 'admin' ? 'admin' : 'member';
  const appSettings = await getAppSettings(c.env);
  const quotaBytes =
    body.quotaMb && Number.isFinite(body.quotaMb) && body.quotaMb > 0
      ? Math.round(body.quotaMb * 1024 * 1024)
      : appSettings.defaultQuotaMb * 1024 * 1024;

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Email không hợp lệ' }, 400);
  }
  if (!name) {
    return c.json({ error: 'Vui lòng nhập tên người dùng' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Mật khẩu tối thiểu 8 ký tự' }, 400);
  }

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) {
    return c.json({ error: 'Email đã tồn tại trong hệ thống' }, 409);
  }

  const now = Date.now();
  const id = randomId('usr');
  const passwordHash = await hashPassword(password);

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, quota_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(id, email, name, passwordHash, role, quotaBytes, now, now)
    .run();

  await logAudit(c, 'admin.user.create', 'user', id, { email, name, role, quotaBytes });
  return c.json({ id, email, name, role, status: 'active', quotaBytes, createdAt: now }, 201);
});

adminRoutes.patch('/users/:id', async (c) => {
  const actor = c.get('user')!;
  const targetId = c.req.param('id');
  const body = await c.req
    .json<{
      name?: string;
      role?: UserRole;
      status?: UserStatus;
      quotaMb?: number;
      password?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          name?: string;
          role?: UserRole;
          status?: UserStatus;
          quotaMb?: number;
          password?: string;
        },
    );

  const target = await c.env.DB.prepare('SELECT id, email, role, status FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; email: string; role: UserRole; status: UserStatus }>();
  if (!target) {
    return c.json({ error: 'Không tìm thấy người dùng' }, 404);
  }

  if (target.id === actor.id && (body.status === 'disabled' || body.role === 'member')) {
    return c.json({ error: 'Không thể tự khóa hoặc hạ quyền chính mình' }, 400);
  }

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('name = ?');
    binds.push(body.name.trim().slice(0, 100));
  }
  if (body.role === 'admin' || body.role === 'member') {
    updates.push('role = ?');
    binds.push(body.role);
  }
  if (body.status === 'active' || body.status === 'disabled') {
    updates.push('status = ?');
    binds.push(body.status);
  }
  if (typeof body.quotaMb === 'number' && Number.isFinite(body.quotaMb) && body.quotaMb > 0) {
    updates.push('quota_bytes = ?');
    binds.push(Math.round(body.quotaMb * 1024 * 1024));
  }
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) {
      return c.json({ error: 'Mật khẩu mới tối thiểu 8 ký tự' }, 400);
    }
    updates.push('password_hash = ?');
    binds.push(await hashPassword(body.password));
  }

  if (updates.length === 0) {
    return c.json({ error: 'Không có thay đổi nào' }, 400);
  }

  updates.push('updated_at = ?');
  binds.push(Date.now(), targetId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

  if (body.status === 'disabled') {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
  }

  await logAudit(c, 'admin.user.update', 'user', targetId, {
    email: target.email,
    changedFields: Object.keys(body).filter((k) => k !== 'password'),
    passwordReset: Boolean(body.password),
  });

  return c.json({ ok: true });
});

adminRoutes.get('/users/:id/detail', async (c) => {
  const targetId = c.req.param('id')!;
  const now = Date.now();
  const [projects, sessions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, status, visibility, asset_count AS assetCount, total_bytes AS totalBytes, updated_at AS updatedAt
       FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50`,
    )
      .bind(targetId)
      .all(),
    c.env.DB.prepare(
      `SELECT id, user_agent AS userAgent, ip, created_at AS createdAt, expires_at AS expiresAt
       FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`,
    )
      .bind(targetId, now)
      .all(),
  ]);
  return c.json({
    projects: projects.results ?? [],
    sessions: sessions.results ?? [],
  });
});

adminRoutes.post('/users/:id/revoke-sessions', async (c) => {
  const targetId = c.req.param('id')!;
  const res = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
  await logAudit(c, 'admin.user.revoke_sessions', 'user', targetId, { revoked: res.meta?.changes ?? 0 });
  return c.json({ ok: true, revoked: res.meta?.changes ?? 0 });
});

adminRoutes.delete('/users/:id', async (c) => {
  const actor = c.get('user')!;
  const targetId = c.req.param('id');

  if (targetId === actor.id) {
    return c.json({ error: 'Không thể tự xóa tài khoản đang đăng nhập' }, 400);
  }

  const target = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; email: string }>();
  if (!target) return c.json({ error: 'Không tìm thấy người dùng' }, 404);

  await deleteUserWithAssets(c.env, targetId);
  await logAudit(c, 'admin.user.delete', 'user', targetId, { email: target.email });
  return c.json({ ok: true });
});

adminRoutes.get('/projects', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const sharedOnly = c.req.query('shared') === '1';
  const statusFilter = (c.req.query('status') ?? '').trim();
  const visFilter = (c.req.query('visibility') ?? '').trim();

  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (q) {
    clauses.push('(LOWER(p.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(p.tags) LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  if (sharedOnly) {
    clauses.push('p.share_enabled = 1');
  }
  if (statusFilter === 'draft' || statusFilter === 'review' || statusFilter === 'approved') {
    clauses.push('p.status = ?');
    binds.push(statusFilter);
  }
  if (visFilter === 'team' || visFilter === 'private') {
    clauses.push('p.visibility = ?');
    binds.push(visFilter);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT
       p.id,
       p.name,
       p.owner_id AS ownerId,
       u.name AS ownerName,
       u.email AS ownerEmail,
       p.thumbnail_key AS thumbnailKey,
       p.asset_count AS assetCount,
       p.total_bytes AS totalBytes,
       p.version,
       p.visibility,
       p.status,
       p.tags,
       p.notes,
       p.share_enabled AS shareEnabled,
       p.share_token AS shareToken,
       p.created_at AS createdAt,
       p.updated_at AS updatedAt
     FROM projects p
     JOIN users u ON u.id = p.owner_id
     ${where}
     ORDER BY p.updated_at DESC
     LIMIT 200`,
  )
    .bind(...binds)
    .all<{
      id: string;
      name: string;
      ownerId: string;
      ownerName: string;
      ownerEmail: string;
      thumbnailKey: string | null;
      assetCount: number;
      totalBytes: number;
      version: number;
      visibility: string;
      status: string;
      tags: string;
      notes: string;
      shareEnabled: number;
      shareToken: string | null;
      createdAt: number;
      updatedAt: number;
    }>();

  return c.json({
    projects: (rows.results ?? []).map((r) => {
      let parsedTags: string[] = [];
      try {
        const t = JSON.parse(r.tags || '[]');
        if (Array.isArray(t)) parsedTags = t.filter((x): x is string => typeof x === 'string');
      } catch {
        parsedTags = [];
      }
      return {
        id: r.id,
        name: r.name,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        ownerEmail: r.ownerEmail,
        thumbnailUrl: r.thumbnailKey ? `/api/projects/${r.id}/thumbnail?v=${r.updatedAt}` : null,
        assetCount: r.assetCount,
        totalBytes: r.totalBytes,
        version: r.version,
        visibility: r.visibility === 'private' ? 'private' : 'team',
        status: r.status === 'review' || r.status === 'approved' ? r.status : 'draft',
        tags: parsedTags,
        notes: r.notes ?? '',
        shareEnabled: r.shareEnabled === 1,
        shareToken: r.shareEnabled === 1 ? r.shareToken : null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }),
  });
});

adminRoutes.patch('/projects/:id', async (c) => {
  const projectId = c.req.param('id')!;
  const body = await c.req
    .json<{
      status?: ProjectStatus;
      visibility?: ProjectVisibility;
      shareEnabled?: boolean;
      ownerId?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          status?: ProjectStatus;
          visibility?: ProjectVisibility;
          shareEnabled?: boolean;
          ownerId?: string;
        },
    );

  const proj = await c.env.DB.prepare('SELECT id, name, owner_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string; name: string; owner_id: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (body.status === 'draft' || body.status === 'review' || body.status === 'approved') {
    updates.push('status = ?');
    binds.push(body.status);
  }
  if (body.visibility === 'team' || body.visibility === 'private') {
    updates.push('visibility = ?');
    binds.push(body.visibility);
  }
  if (typeof body.shareEnabled === 'boolean') {
    updates.push('share_enabled = ?');
    binds.push(body.shareEnabled ? 1 : 0);
  }
  if (typeof body.ownerId === 'string' && body.ownerId.trim() && body.ownerId !== proj.owner_id) {
    const newOwner = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(body.ownerId.trim())
      .first<{ id: string; email: string }>();
    if (!newOwner) return c.json({ error: 'Không tìm thấy chủ sở hữu mới' }, 404);
    updates.push('owner_id = ?');
    binds.push(newOwner.id);
    await c.env.DB.prepare('UPDATE assets SET owner_id = ? WHERE project_id = ?')
      .bind(newOwner.id, projectId)
      .run();
  }

  if (updates.length === 0) return c.json({ error: 'Không có thay đổi nào' }, 400);
  updates.push('updated_at = ?');
  binds.push(Date.now(), projectId);

  await c.env.DB.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  await logAudit(c, 'admin.project.update', 'project', projectId, { name: proj.name, ...body });
  return c.json({ ok: true });
});

adminRoutes.get('/settings', async (c) => {
  const settings = await getAppSettings(c.env);
  return c.json({ settings });
});

adminRoutes.patch('/settings', async (c) => {
  const body = await c.req
    .json<{
      defaultQuotaMb?: number;
      defaultVisibility?: ProjectVisibility;
      allowPublicShare?: boolean;
      maxVersionsPerProject?: number;
    }>()
    .catch(
      () =>
        ({}) as {
          defaultQuotaMb?: number;
          defaultVisibility?: ProjectVisibility;
          allowPublicShare?: boolean;
          maxVersionsPerProject?: number;
        },
    );
  const settings = await updateAppSettings(c.env, body);
  await logAudit(c, 'admin.settings.update', 'system', 'app_settings', settings as unknown as Record<string, unknown>);
  return c.json({ settings });
});

adminRoutes.post('/maintenance/sessions', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
  const deleted = res.meta?.changes ?? 0;
  await logAudit(c, 'admin.maintenance.sessions', 'system', 'sessions', { deleted });
  return c.json({ ok: true, deleted });
});

adminRoutes.post('/maintenance/r2-gc', async (c) => {
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({}) as { dryRun?: boolean });
  const result = await cleanOrphanR2Objects(c.env, Boolean(body.dryRun));
  if (!body.dryRun) {
    await logAudit(c, 'admin.maintenance.r2_gc', 'system', 'r2', result);
  }
  return c.json({ ok: true, ...result });
});

adminRoutes.delete('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const proj = await c.env.DB.prepare('SELECT id, name, owner_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string; name: string; owner_id: string }>();
  if (!proj) return c.json({ error: 'Không tìm thấy project' }, 404);

  await deleteProjectWithAssets(c.env, projectId);
  await logAudit(c, 'admin.project.delete', 'project', projectId, { name: proj.name, ownerId: proj.owner_id });
  return c.json({ ok: true });
});

adminRoutes.get('/audit', async (c) => {
  const action = (c.req.query('action') ?? '').trim();
  const limit = Math.min(200, Math.max(10, Number.parseInt(c.req.query('limit') ?? '80', 10) || 80));

  const sql = action
    ? `SELECT id, actor_email AS actorEmail, action, target_type AS targetType, target_id AS targetId, detail_json AS detailJson, ip, created_at AS createdAt
       FROM audit_logs WHERE action LIKE ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, actor_email AS actorEmail, action, target_type AS targetType, target_id AS targetId, detail_json AS detailJson, ip, created_at AS createdAt
       FROM audit_logs ORDER BY created_at DESC LIMIT ?`;

  const stmt = action
    ? c.env.DB.prepare(sql).bind(`${action}%`, limit)
    : c.env.DB.prepare(sql).bind(limit);
  const rows = await stmt.all();

  return c.json({ logs: rows.results ?? [] });
});
