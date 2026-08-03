import { purchasesError } from './purchases-v2';

export type StripeEnvironment = 'sandbox' | 'production';

export type StripeCredentials = {
  secret_key: string;
  webhook_secret: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function validateStripeCredentials(
  value: unknown,
  environment: StripeEnvironment,
): StripeCredentials {
  const credentials = record(value);
  const secretKey = String(credentials.secret_key || credentials.api_key || '').trim();
  const webhookSecret = String(credentials.webhook_secret || '').trim();
  const expectedPrefix = environment === 'sandbox' ? 'sk_test_' : 'sk_live_';
  const oppositePrefix = environment === 'sandbox' ? 'sk_live_' : 'sk_test_';

  if (secretKey.startsWith(oppositePrefix)) {
    throw purchasesError(
      'stripe_environment_mismatch',
      `A ${environment === 'sandbox' ? 'test' : 'live'} Stripe secret key is required for this environment`,
      422,
    );
  }
  if (!secretKey.startsWith(expectedPrefix) || secretKey.length <= expectedPrefix.length) {
    throw purchasesError(
      'stripe_secret_invalid',
      `Stripe ${environment === 'sandbox' ? 'test' : 'live'} secret key is invalid`,
      422,
    );
  }
  if (!webhookSecret.startsWith('whsec_') || webhookSecret.length <= 'whsec_'.length) {
    throw purchasesError('stripe_webhook_secret_invalid', 'Stripe webhook signing secret is invalid', 422);
  }
  return { secret_key: secretKey, webhook_secret: webhookSecret };
}
