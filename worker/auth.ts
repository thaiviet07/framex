import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, randomId, randomToken, sha256Hex } from './crypto';
import type { AppEnv, Env, SafeUser, UserRow } from './types';

export const SESSION_COOKIE = 'fx_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    quotaBytes: row.quota_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function defaultQuotaBytes(env: Env): number {
  const mb = Number.parseInt(env.DEFAULT_QUOTA_MB ?? '500', 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
}

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function ensureBootstrapAdmin(env: Env): Promise<void> {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) return;
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>();
  if ((countRow?.cnt ?? 0) > 0) return;

  const now = Date.now();
  const id = randomId('usr');
  const hash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  const email = env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const name = env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Admin';
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, status, quota_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?)`,
  )
    .bind(id, email, name, hash, defaultQuotaBytes(env) * 4, now, now)
    .run();
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const rawToken = randomToken(32);
  const sessionId = await sha256Hex(rawToken);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, expiresAt, c.req.header('user-agent')?.slice(0, 240) ?? null, clientIp(c), now)
    .run();

  const isHttps = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSession(c: Context<AppEnv>): Promise<void> {
  const rawToken = getCookie(c, SESSION_COOKIE);
  if (rawToken) {
    const sessionId = await sha256Hex(rawToken);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function loadSessionMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  c.set('user', null);
  c.set('sessionId', null);

  const rawToken = getCookie(c, SESSION_COOKIE);
  if (rawToken) {
    const sessionId = await sha256Hex(rawToken);
    const now = Date.now();
    const row = await c.env.DB.prepare(
      `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(sessionId, now)
      .first<UserRow>();

    if (row && row.status === 'active') {
      c.set('user', toSafeUser(row));
      c.set('sessionId', sessionId);
    } else if (row) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
  }
  await next();
}

export async function requireAuth(c: Context<AppEnv>, next: Next): Promise<Response | undefined> {
  if (!c.get('user')) {
    return c.json({ error: 'Vui lòng đăng nhập để tiếp tục' }, 401);
  }
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next): Promise<Response | undefined> {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Vui lòng đăng nhập' }, 401);
  }
  if (user.role !== 'admin') {
    return c.json({ error: 'Bạn không có quyền quản trị' }, 403);
  }
  await next();
}

export async function logAudit(
  c: Context<AppEnv>,
  action: string,
  targetType: 'user' | 'project' | 'system' | null = null,
  targetId: string | null = null,
  detail: Record<string, unknown> | null = null,
  actorOverride?: { id: string | null; email: string | null },
): Promise<void> {
  const user = c.get('user');
  const actorId = actorOverride ? actorOverride.id : (user?.id ?? null);
  const actorEmail = actorOverride ? actorOverride.email : (user?.email ?? null);
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, detail_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        randomId('aud'),
        actorId,
        actorEmail,
        action,
        targetType,
        targetId,
        detail ? JSON.stringify(detail) : null,
        clientIp(c),
        Date.now(),
      )
      .run();
  } catch {
    // Non-fatal: audit log failure shouldn't break main action
  }
}
