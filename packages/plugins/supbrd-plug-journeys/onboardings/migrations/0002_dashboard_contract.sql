ALTER TABLE onboardings ADD COLUMN identifier TEXT;
ALTER TABLE onboardings ADD COLUMN display_name TEXT;
ALTER TABLE onboardings ADD COLUMN active_version INTEGER;
ALTER TABLE onboardings ADD COLUMN active_version_id TEXT;
ALTER TABLE onboarding_versions ADD COLUMN project_id TEXT;
CREATE UNIQUE INDEX onboarding_identifier ON onboardings(project_id, identifier);
CREATE INDEX onboarding_versions_project ON onboarding_versions(project_id, onboarding_id, version DESC);
