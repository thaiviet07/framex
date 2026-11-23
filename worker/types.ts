export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  APP_NAME?: string;
  DEFAULT_QUOTA_MB?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_ADMIN_NAME?: string;
}

export type UserRole = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
export type ProjectVisibility = 'team' | 'private';
export type ProjectStatus = 'draft' | 'review' | 'approved';

export interface AppSettings {
  defaultQuotaMb: number;
  defaultVisibility: ProjectVisibility;
  allowPublicShare: boolean;
  maxVersionsPerProject: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  quota_bytes: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface SafeUser {
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

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  data_json: string;
  thumbnail_key: string | null;
  asset_count: number;
  total_bytes: number;
  version: number;
  share_token: string | null;
  share_enabled: number;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  tags: string;
  notes: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectVersionRow {
  id: string;
  project_id: string;
  version: number;
  name: string;
  data_json: string;
  asset_manifest_json: string;
  saved_by: string | null;
  saved_by_name: string | null;
  note: string;
  created_at: number;
}

export interface AssetRow {
  id: string;
  project_id: string;
  owner_id: string;
  asset_id: string;
  name: string;
  mime_type: string;
  width: number;
  height: number;
  size_bytes: number;
  sha256: string;
  r2_key: string;
  uploaded: number;
  created_at: number;
}

export interface AppVariables {
  user: SafeUser | null;
  sessionId: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};
