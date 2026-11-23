import type { AppSettings, Env, ProjectVisibility } from './types';

export async function getAppSettings(env: Env): Promise<AppSettings> {
  const defaultQuotaMb = Math.max(50, Number.parseInt(env.DEFAULT_QUOTA_MB ?? '500', 10) || 500);
  const defaults: AppSettings = {
    defaultQuotaMb,
    defaultVisibility: 'team',
    allowPublicShare: true,
    maxVersionsPerProject: 15,
  };

  try {
    const rows = await env.DB.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>();
    const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));

    const q = Number.parseInt(map.get('default_quota_mb') ?? '', 10);
    if (Number.isFinite(q) && q >= 50) defaults.defaultQuotaMb = q;

    const vis = map.get('default_visibility');
    if (vis === 'team' || vis === 'private') defaults.defaultVisibility = vis as ProjectVisibility;

    const allowShare = map.get('allow_public_share');
    if (allowShare === '0' || allowShare === 'false') defaults.allowPublicShare = false;
    else if (allowShare === '1' || allowShare === 'true') defaults.allowPublicShare = true;

    const maxVer = Number.parseInt(map.get('max_versions_per_project') ?? '', 10);
    if (Number.isFinite(maxVer) && maxVer >= 1 && maxVer <= 100) defaults.maxVersionsPerProject = maxVer;
  } catch {
    // Fallback to defaults if table not yet migrated
  }

  return defaults;
}

export async function updateAppSettings(env: Env, patch: Partial<AppSettings>): Promise<AppSettings> {
  const now = Date.now();
  const pairs: Array<[string, string]> = [];

  if (typeof patch.defaultQuotaMb === 'number' && Number.isFinite(patch.defaultQuotaMb)) {
    pairs.push(['default_quota_mb', String(Math.max(50, Math.min(100_000, Math.round(patch.defaultQuotaMb))))]);
  }
  if (patch.defaultVisibility === 'team' || patch.defaultVisibility === 'private') {
    pairs.push(['default_visibility', patch.defaultVisibility]);
  }
  if (typeof patch.allowPublicShare === 'boolean') {
    pairs.push(['allow_public_share', patch.allowPublicShare ? '1' : '0']);
  }
  if (typeof patch.maxVersionsPerProject === 'number' && Number.isFinite(patch.maxVersionsPerProject)) {
    pairs.push([
      'max_versions_per_project',
      String(Math.max(1, Math.min(100, Math.round(patch.maxVersionsPerProject)))),
    ]);
  }

  for (const [key, value] of pairs) {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(key, value, now)
      .run();
  }

  return getAppSettings(env);
}
