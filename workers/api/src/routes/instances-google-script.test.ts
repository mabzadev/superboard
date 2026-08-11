import { describe, expect, it } from 'vitest';
import { buildGoogleConfigurationScript } from './instances';

describe('Google Play RTDN setup script', () => {
  it('reuses the configured Play identity and an existing RTDN topic', () => {
    const script = buildGoogleConfigurationScript({
      instanceId: 10,
      apiDomain: 'api.example.com',
      projectId: 'example-project-123',
      serviceAccountEmail: 'play-api@example-project-123.iam.gserviceaccount.com',
    });

    expect(script).toContain('PROJECT_ID="$CONFIGURED_PROJECT_ID"');
    expect(script).toContain('TOPIC_NAME="$1"');
    expect(script).toContain('SA_EMAIL="play-api@example-project-123.iam.gserviceaccount.com"');
    expect(script).toContain('gcloud pubsub topics describe "$TOPIC_NAME"');
    expect(script).toContain('gcloud beta services identity create --service=pubsub.googleapis.com');
    expect(script).toContain('--push-auth-service-account="$SA_EMAIL"');
    expect(script).toContain('--push-auth-token-audience="$PUSH_AUDIENCE"');
    expect(script).toContain('PUSH_ENDPOINT="https://api.example.com/api/v1/iap/google/10"');
    expect(script).not.toContain('gcloud iam service-accounts create');
    expect(script).not.toContain('gcloud pubsub topics create');
  });
});
