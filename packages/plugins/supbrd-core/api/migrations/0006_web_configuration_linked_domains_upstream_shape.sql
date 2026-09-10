-- Migration 0006: align web_configuration_linked_domains with upstream Grovs.
--
-- Upstream stores linked web domains directly on web_configuration_linked_domains
-- as a string column. The earlier Cloudflare compatibility table kept a domain_id
-- foreign key, which prevents multiple arbitrary web SDK domains from being
-- registered in the dashboard.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS web_configuration_linked_domains_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  web_configuration_id TEXT,
  domain TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (web_configuration_id) REFERENCES web_configurations(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO web_configuration_linked_domains_new (
  id,
  web_configuration_id,
  domain,
  created_at,
  updated_at
)
SELECT
  id,
  web_configuration_id,
  domain,
  created_at,
  updated_at
FROM web_configuration_linked_domains
WHERE domain IS NOT NULL;

DROP TABLE web_configuration_linked_domains;

ALTER TABLE web_configuration_linked_domains_new RENAME TO web_configuration_linked_domains;

CREATE INDEX IF NOT EXISTS index_web_configuration_linked_domains_on_web_configuration_id
  ON web_configuration_linked_domains(web_configuration_id);

CREATE UNIQUE INDEX IF NOT EXISTS index_web_configuration_linked_domains_unique
  ON web_configuration_linked_domains(web_configuration_id, domain);

PRAGMA foreign_keys = ON;
