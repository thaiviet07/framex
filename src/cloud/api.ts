import type { Asset, Project } from '../model/types';

export type UserRole = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
export type ProjectVisibility = 'team' | 'private';
export type ProjectStatus = 'draft' | 'review' | 'approved';

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  quotaBytes: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthMeResponse {
  user: CloudUser | null;
  usedBytes?: number;
  setupRequired: boolean;
  settings?: {
    defaultVisibility: ProjectVisibility;
    allowPublicShare: boolean;
  };
}

export interface CloudSessionItem {
  id: string;
  fullId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

export interface CloudProjectSummary {
  id: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  isOwner: boolean;
  name: string;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  tags: string[];
  notes: string;
  hasThumbnail: boolean;
  thumbnailUrl: string | null;
  assetCount: number;
  totalBytes: number;
  version: number;
  shareEnabled: boolean;
  shareToken: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CloudProjectDetail {
  meta: CloudProjectSummary;
  project: Project;
  assets: Array<{
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    sizeBytes: number;
    sha256: string;
    uploaded: boolean;
    url: string;
  }>;
}

export interface CloudVersionSummary {
  id: string;
  version: number;
  name: string;
  savedByName: string | null;
  note: string;
  createdAt: number;
}

export interface CloudVersionDetail {
  version: CloudVersionSummary;
  project: Project;
  assets: Array<{
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    sizeBytes: number;
    url: string;
  }>;
}

export interface SharedProjectDetail {
  meta: {
    id: string;
    name: string;
    ownerName: string;
    updatedAt: number;
    version: number;
  };
  project: Project;
  assets: Array<{
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    sizeBytes: number;
    url: string;
  }>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export const cloudApi = {
  me: () => apiJson<AuthMeResponse>('/api/auth/me'),
  setup: (email: string, name: string, password: string) =>
    apiJson<{ user: CloudUser; usedBytes: number }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    }),
  login: (email: string, password: string) =>
    apiJson<{ user: CloudUser; usedBytes: number }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (name: string) =>
    apiJson<{ ok: boolean; name: string }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiJson<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listSessions: () => apiJson<{ sessions: CloudSessionItem[] }>('/api/auth/sessions'),
  revokeSession: (fullId: string) =>
    apiJson<{ ok: boolean }>(`/api/auth/sessions/${encodeURIComponent(fullId)}`, { method: 'DELETE' }),
  revokeOtherSessions: () =>
    apiJson<{ ok: boolean; revoked: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }),

  listProjects: () =>
    apiJson<{ projects: CloudProjectSummary[]; usedBytes: number; quotaBytes: number }>('/api/projects'),
  getProject: (id: string) => apiJson<CloudProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),
  deleteProject: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateProject: (id: string) =>
    apiJson<{ project: CloudProjectSummary }>(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    }),
  setVisibility: (id: string, visibility: ProjectVisibility) =>
    apiJson<{ ok: boolean; visibility: ProjectVisibility }>(
      `/api/projects/${encodeURIComponent(id)}/visibility`,
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      },
    ),
  updateProjectMeta: (
    id: string,
    patch: {
      name?: string;
      status?: ProjectStatus;
      tags?: string[];
      notes?: string;
      visibility?: ProjectVisibility;
    },
  ) =>
    apiJson<{ project: CloudProjectSummary }>(`/api/projects/${encodeURIComponent(id)}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  listVersions: (projectId: string) =>
    apiJson<{ versions: CloudVersionSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/versions`),
  getVersion: (projectId: string, versionId: string) =>
    apiJson<CloudVersionDetail>(
      `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    ),
  toggleShare: (id: string, enabled: boolean, regenerate = false) =>
    apiJson<{ shareEnabled: boolean; shareToken: string | null; shareUrl: string | null }>(
      `/api/projects/${encodeURIComponent(id)}/share`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled, regenerate }),
      },
    ),
  getShared: (token: string) => apiJson<SharedProjectDetail>(`/api/share/${encodeURIComponent(token)}`),

  async saveProject(
    project: Project,
    assetList: Asset[],
    options?: {
      cloudId?: string;
      visibility?: ProjectVisibility;
      status?: ProjectStatus;
      tags?: string[];
      notes?: string;
      versionNote?: string;
      thumbnail?: Blob | null;
      onProgress?: (label: string, ratio: number) => void;
    },
  ): Promise<CloudProjectSummary> {
    const report = options?.onProgress ?? (() => {});
    report('Đang kiểm tra tài nguyên…', 0.1);

    const manifest: Array<{
      id: string;
      name: string;
      type: string;
      width: number;
      height: number;
      sizeBytes: number;
      sha256: string;
    }> = [];
    const byId = new Map<string, Asset>();

    for (let i = 0; i < assetList.length; i++) {
      const a = assetList[i];
      byId.set(a.id, a);
      const sha256 = await sha256Blob(a.blob);
      manifest.push({
        id: a.id,
        name: a.name,
        type: a.type,
        width: a.width,
        height: a.height,
        sizeBytes: a.blob.size,
        sha256,
      });
      report(`Đang tính mã băm (${i + 1}/${assetList.length})…`, 0.1 + 0.2 * ((i + 1) / Math.max(1, assetList.length)));
    }

    report('Đang đồng bộ metadata lên D1…', 0.35);
    const res = await apiJson<{ project: CloudProjectSummary; missingAssets: string[] }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: options?.cloudId,
        name: project.name,
        visibility: options?.visibility,
        status: options?.status,
        tags: options?.tags,
        notes: options?.notes,
        versionNote: options?.versionNote,
        project,
        assets: manifest,
      }),
    });

    const saved = res.project;
    const missing = res.missingAssets ?? [];

    for (let i = 0; i < missing.length; i++) {
      const assetId = missing[i];
      const asset = byId.get(assetId);
      if (!asset) continue;
      report(`Đang tải lên R2 (${i + 1}/${missing.length}): ${asset.name}`, 0.4 + 0.5 * (i / Math.max(1, missing.length)));
      const upRes = await fetch(
        `/api/projects/${encodeURIComponent(saved.id)}/assets/${encodeURIComponent(asset.id)}`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': asset.type || 'application/octet-stream' },
          body: asset.blob,
        },
      );
      if (!upRes.ok) {
        const errData = (await upRes.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(errData.error || `Upload thất bại (${upRes.status})`, upRes.status);
      }
    }

    if (options?.thumbnail && options.thumbnail.size > 0) {
      report('Đang cập nhật ảnh thu nhỏ…', 0.94);
      await fetch(`/api/projects/${encodeURIComponent(saved.id)}/thumbnail`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': options.thumbnail.type || 'image/webp' },
        body: options.thumbnail,
      }).catch(() => {});
    }

    report('Hoàn tất lưu Cloud', 1);
    return saved;
  },

  async downloadAssets(
    assetList: Array<{ id: string; name: string; type: string; width: number; height: number; url: string }>,
    onProgress?: (label: string, ratio: number) => void,
  ): Promise<Asset[]> {
    const out: Asset[] = [];
    for (let i = 0; i < assetList.length; i++) {
      const a = assetList[i];
      onProgress?.(`Đang tải tài nguyên (${i + 1}/${assetList.length})…`, (i + 1) / Math.max(1, assetList.length));
      const res = await fetch(a.url, { credentials: 'same-origin' });
      if (!res.ok) continue;
      const blob = await res.blob();
      out.push({
        id: a.id,
        name: a.name,
        type: a.type || blob.type || 'image/png',
        width: a.width,
        height: a.height,
        blob,
      });
    }
    return out;
  },
};
