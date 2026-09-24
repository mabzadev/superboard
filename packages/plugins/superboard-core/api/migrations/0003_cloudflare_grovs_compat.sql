-- Historical compatibility migration. Names are preserved only because D1 tracks
-- applied migrations by filename; all seed credentials are disabled placeholders.

ALTER TABLE domains ADD COLUMN google_tracking_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_project_unique ON domains(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_redirects_unique ON redirects(redirect_config_id, platform, variation);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_instance_platform ON applications(instance_id, platform);

UPDATE OR IGNORE oauth_applications
SET uid = 'legacy-vocostar-disabled'
WHERE uid = 'legacy-dashboard-disabled';

INSERT OR IGNORE INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
VALUES (
  'Legacy Dashboard Vocostar (disabled)',
  'legacy-vocostar-disabled',
  'DISABLED_ROTATE_VIA_BOOTSTRAP',
  'urn:ietf:wg:oauth:2.0:oob',
  'read write'
);
