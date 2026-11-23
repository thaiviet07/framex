import { Hono } from 'hono';
import {
  clearSession,
  createSession,
  defaultQuotaBytes,
  ensureBootstrapAdmin,
  logAudit,
  requireAuth,
  toSafeUser,
} from '../auth';
import { hashPassword, randomId, verifyPassword } from '../crypto';
import { getAppSettings } from '../settings';
import { getUserUsedBytes } from '../storage';
import type { AppEnv, UserRow } from '../types';

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/health', async (c) => {
  await ensureBootstrapAdmin(c.env);
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>();
  return c.json({
    ok: true,
    appName: c.env.APP_NAME ?? 'FX Studio',
    setupRequired: (countRow?.cnt ?? 0) === 0,
  });
});

authRoutes.post('/auth/setup', async (c) => {
  await ensureBootstrapAdmin(c.env);
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>();
  if ((countRow?.cnt ?? 0) > 0) {
    return c.json({ error: 'Hệ thống đã được khởi tạo tài khoản quản trị' }, 403);
  }

  const body = await c.req
    .json<{ email?: string; name?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; name?: string; password?: string });
  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim() || 'Admin';
  const password = body.password ?? '';

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Email không hợp lệ' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Mật khẩu tối thiểu 8 ký tự' }, 400);
  }

  const now = Date.now();
  const id = randomId('usr');
  const passwordHash = await hashPassword(password);
  const quotaBytes = defaultQuotaBytes(c.env) * 4;

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, quota_bytes, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?)`,
  )
    .bind(id, email, name, passwordHash, quotaBytes, now, now, now)
    .run();

  await createSession(c, id);
  await logAudit(c, 'system.bootstrap', 'user', id, { email, name }, { id, email });

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return c.json({ user: row ? toSafeUser(row) : null, usedBytes: 0 }, 201);
});

authRoutes.post('/auth/login', async (c) => {
  await ensureBootstrapAdmin(c.env);
  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; password?: string });
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !password) {
    return c.json({ error: 'Vui lòng nhập email và mật khẩu' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401);
  }
  if (row.status !== 'active') {
    return c.json({ error: 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' }, 403);
  }

  const now = Date.now();
  await c.env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, row.id)
    .run();

  await createSession(c, row.id);
  await logAudit(c, 'auth.login', 'user', row.id, null, { id: row.id, email: row.email });

  const usedBytes = await getUserUsedBytes(c.env.DB, row.id);
  return c.json({
    user: toSafeUser({ ...row, last_login_at: now }),
    usedBytes,
  });
});

authRoutes.post('/auth/logout', async (c) => {
  const user = c.get('user');
  await clearSession(c);
  if (user) {
    await logAudit(c, 'auth.logout', 'user', user.id, null, { id: user.id, email: user.email });
  }
  return c.json({ ok: true });
});

authRoutes.get('/auth/me', async (c) => {
  await ensureBootstrapAdmin(c.env);
  const user = c.get('user');
  if (!user) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>();
    return c.json({ user: null, setupRequired: (countRow?.cnt ?? 0) === 0 });
  }
  const [usedBytes, settings] = await Promise.all([
    getUserUsedBytes(c.env.DB, user.id),
    getAppSettings(c.env),
  ]);
  return c.json({
    user,
    usedBytes,
    setupRequired: false,
    settings: {
      defaultVisibility: settings.defaultVisibility,
      allowPublicShare: settings.allowPublicShare,
    },
  });
});

authRoutes.patch('/auth/profile', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = (body.name ?? '').trim().slice(0, 100);
  if (!name) {
    return c.json({ error: 'Tên hiển thị không được để trống' }, 400);
  }
  const now = Date.now();
  await c.env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, now, user.id)
    .run();
  await logAudit(c, 'auth.profile_update', 'user', user.id, { name });
  return c.json({ ok: true, name });
});

authRoutes.get('/auth/sessions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const curSid = c.get('sessionId');
  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT id, user_agent AS userAgent, ip, created_at AS createdAt, expires_at AS expiresAt
     FROM sessions
     WHERE user_id = ? AND expires_at > ?
     ORDER BY created_at DESC`,
  )
    .bind(user.id, now)
    .all<{ id: string; userAgent: string | null; ip: string | null; createdAt: number; expiresAt: number }>();

  return c.json({
    sessions: (rows.results ?? []).map((s) => ({
      id: s.id.slice(0, 12),
      fullId: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === curSid,
    })),
  });
});

authRoutes.delete('/auth/sessions/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const targetId = c.req.param('id')!;
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .bind(targetId, user.id)
    .run();
  await logAudit(c, 'auth.session_revoke', 'user', user.id);
  return c.json({ ok: true });
});

authRoutes.post('/auth/sessions/revoke-others', requireAuth, async (c) => {
  const user = c.get('user')!;
  const curSid = c.get('sessionId');
  const res = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(user.id, curSid ?? '')
    .run();
  await logAudit(c, 'auth.sessions_revoke_others', 'user', user.id, { revoked: res.meta?.changes ?? 0 });
  return c.json({ ok: true, revoked: res.meta?.changes ?? 0 });
});

authRoutes.post('/auth/password', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => ({}) as { currentPassword?: string; newPassword?: string });
  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';

  if (newPassword.length < 8) {
    return c.json({ error: 'Mật khẩu mới tối thiểu 8 ký tự' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return c.json({ error: 'Mật khẩu hiện tại không đúng' }, 400);
  }

  const nextHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(nextHash, Date.now(), user.id)
    .run();

  await logAudit(c, 'auth.password_change', 'user', user.id);
  return c.json({ ok: true });
});
