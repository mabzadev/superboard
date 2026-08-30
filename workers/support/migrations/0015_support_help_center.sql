PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_portals (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
  custom_domain TEXT,
  domain_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (domain_status IN ('unconfigured', 'pending', 'verified', 'failed')),
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, slug),
  UNIQUE(custom_domain)
);

CREATE TABLE IF NOT EXISTS support_portal_categories (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  portal_id TEXT NOT NULL REFERENCES support_portals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(portal_id, slug)
);

CREATE TABLE IF NOT EXISTS support_portal_folders (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  portal_id TEXT NOT NULL REFERENCES support_portals(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES support_portal_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(portal_id, slug)
);

CREATE TABLE IF NOT EXISTS support_articles (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  portal_id TEXT NOT NULL REFERENCES support_portals(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES support_portal_categories(id) ON DELETE SET NULL,
  folder_id TEXT REFERENCES support_portal_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  author_id TEXT NOT NULL,
  published_at TEXT,
  indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(portal_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_support_articles_public
  ON support_articles(portal_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS support_article_translations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  article_id TEXT NOT NULL REFERENCES support_articles(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  translated_by TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(article_id, locale)
);

CREATE TABLE IF NOT EXISTS support_article_views (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  portal_id TEXT NOT NULL REFERENCES support_portals(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES support_articles(id) ON DELETE CASCADE,
  viewer_hash TEXT,
  locale TEXT,
  referrer_host TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_article_views_article
  ON support_article_views(project_id, article_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_knowledge_documents (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('article', 'file', 'text', 'url')),
  source_id TEXT,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  storage_key TEXT,
  vector_namespace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'indexing', 'indexed', 'failed', 'deleted')),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  indexed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_support_knowledge_documents_status
  ON support_knowledge_documents(project_id, status, updated_at);
