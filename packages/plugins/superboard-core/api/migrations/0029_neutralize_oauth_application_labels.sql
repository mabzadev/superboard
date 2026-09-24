-- Keep deployment-specific OAuth identifiers stable while ensuring that
-- application names exposed by OAuth and administration surfaces are neutral.
UPDATE oauth_applications
SET name = 'SuperBoard Dashboard', updated_at = datetime('now')
WHERE uid = 'superboard-vocostar';

UPDATE oauth_applications
SET name = 'Legacy Dashboard (disabled)', updated_at = datetime('now')
WHERE uid = 'legacy-vocostar-disabled';
