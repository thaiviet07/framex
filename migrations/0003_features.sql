-- Phase 3 features: project workflow status, tags, notes, version history, and global app settings

ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE projects ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_projects_status_updated ON projects(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  asset_manifest_json TEXT NOT NULL DEFAULT '[]',
  saved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  saved_by_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON project_versions(project_id, version DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
