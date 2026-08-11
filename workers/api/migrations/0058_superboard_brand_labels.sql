-- Forward-only visible-brand migration. Stable OAuth client identifiers remain
-- unchanged so existing sessions and configured callbacks keep working.
UPDATE oauth_applications
SET name = 'SuperBoard Dashboard', updated_at = datetime('now')
WHERE name = 'OpenGrow Dashboard';
