-- OpenGrow identity cutover. A high-entropy secret is written separately by
-- scripts/cloudflare-rotate-oauth.mjs and never appears in source control.
INSERT OR IGNORE INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
VALUES (
  'OpenGrow Dashboard Vocostar',
  'opengrow-vocostar',
  'DISABLED_ROTATE_VIA_BOOTSTRAP',
  'urn:ietf:wg:oauth:2.0:oob',
  'read write'
);

UPDATE oauth_applications
SET name = 'OpenGrow Dashboard Vocostar', updated_at = datetime('now')
WHERE uid = 'opengrow-vocostar';
