export const TEST_USER = {
  email: "test@example.com",
  password: "TestPass123!",
  name: "Test User",
  id: "user-test-id-001",
};

export const TEST_INSTANCE = {
  id: "inst-test-001",
  name: "Test Project",
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  revenue_collection_enabled: false,
  get_started_dismissed: true,
};

export const TEST_PROJECT = {
  id: "proj-test-001",
  name: "production",
  instance_id: TEST_INSTANCE.id,
  environment: "production",
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

export const TEST_SUBSCRIPTION = {
  id: "sub-test-001",
  plan_name: "Growth",
  status: "active",
  current_maus: 500,
  total_maus: 10000,
};

export const MOCK_TOKENS = {
  access_token: "mock-access-token-for-testing",
  refresh_token: "mock-refresh-token-for-testing",
  token_type: "Bearer",
  expires_in: 7200,
};
