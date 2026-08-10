export const TEST_USER = {
  email: "test@example.com",
  password: "TestPass123!",
  name: "Test User",
  id: "user-test-id-001",
};

const TEST_INSTANCE_ID = "inst-test-001";

export const TEST_PROJECT = {
  id: "proj-test-001",
  name: "Test Project",
  domain: "test.opengrow.io",
  instance_id: TEST_INSTANCE_ID,
  environment: "production",
};

export const TEST_INSTANCE = {
  id: TEST_INSTANCE_ID,
  name: "Test Project",
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  revenue_collection_enabled: false,
  get_started_dismissed: true,
  projects: [TEST_PROJECT],
  production: TEST_PROJECT,
  test: {
    ...TEST_PROJECT,
    id: "proj-test-002",
    name: "Test Project (Test)",
    environment: "test",
  },
  api_key: "e2e-api-key",
  hash_id: "e2e-project",
  uri_scheme: "opengrow-e2e",
};

export const TEST_LINK = {
  id: "link-test-001",
  name: "Test Link",
  path: "test-link",
  url: "https://test.opengrow.io/test-link",
  views: 42,
  installs: 10,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived: false,
  ads_platform: "quick_link",
};

export const TEST_CAMPAIGN = {
  id: "camp-test-001",
  name: "Test Campaign",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived: false,
};

export const MOCK_TOKENS = {
  access_token: "mock-access-token-for-testing",
  refresh_token: "mock-refresh-token-for-testing",
  token_type: "Bearer",
  expires_in: 7200,
};
