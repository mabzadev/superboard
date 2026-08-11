-- App configuration stores identifiers and setup progress, never credentials.
-- Remove legacy fields that could have contained a secret before the API began
-- enforcing opaque Secret Store/operator references.
UPDATE sdk_configurations
SET configuration_json = json_remove(
  configuration_json,
  '$.push_credential',
  '$.store_credential',
  '$.push_secret',
  '$.store_secret',
  '$.password',
  '$.private_key'
)
WHERE json_type(configuration_json, '$.push_credential') IS NOT NULL
   OR json_type(configuration_json, '$.store_credential') IS NOT NULL
   OR json_type(configuration_json, '$.push_secret') IS NOT NULL
   OR json_type(configuration_json, '$.store_secret') IS NOT NULL
   OR json_type(configuration_json, '$.password') IS NOT NULL
   OR json_type(configuration_json, '$.private_key') IS NOT NULL;
