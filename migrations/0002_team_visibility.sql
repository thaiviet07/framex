-- Add team visibility flag to projects (default: 'team' = shared with all internal users)
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'team';
CREATE INDEX IF NOT EXISTS idx_projects_visibility_updated ON projects(visibility, updated_at DESC);
