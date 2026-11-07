ALTER TABLE identity_configuration ADD COLUMN extended_values_json TEXT;

ALTER TABLE identity_configuration_history ADD COLUMN extended_values_json TEXT;
