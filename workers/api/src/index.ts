import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import oauthRoutes from './routes/oauth';
import linksRoutes from './routes/links';
import instancesRoutes from './routes/instances';
import projectsRoutes from './routes/projects';
import mcpRoutes from './routes/mcp';
import mcpOauthRoutes from './routes/mcp-oauth';
import sdkRoutes from './routes/sdk';
import analyticsRoutes from './routes/analytics';
import webhooksRoutes from './routes/webhooks';
import pushRoutes from './routes/push';
import iapRoutes from './routes/iap';
import identitySsoRoutes from './routes/identity-sso';
import notificationsRoutes from './routes/notifications';
import automationRoutes from './routes/automation';
import diagnosticsRoutes from './routes/diagnostics';
import adminRoutes from './routes/admin';
import wellKnownRoutes from './routes/well-known';
import purchasesAdminRoutes from './routes/purchases-admin';
import purchasesV2AdminRoutes from './routes/purchases-v2-admin';
import purchasesProviderWebhooks from './routes/purchases-provider-webhooks';
import storeReviewsAdminRoutes from './routes/store-reviews-admin';
import messagingAdminRoutes from './routes/messaging-admin';
import growthAdminRoutes from './routes/growth-admin';
import inboxAdminRoutes from './routes/inbox-admin';
import redirectRoute from './routes/redirect';
import { runMaintenance } from './lib/maintenance';
import { dispatchQueueJob } from './lib/jobs';
import { isSsoEnabled } from './lib/deployment';
import { purchasesSigningJwks } from './lib/billing-identity';
import { dispatchBillingServiceJob, billingServiceEnabled } from './lib/billing-service';
import { isBillingQueueJob } from './lib/billing-dispatch';
import { readTextLimited } from './lib/http-limits';
import { emitBillingGrowthEvent } from './lib/growth-delivery';

const app = new Hono<{ Bindings: Env }>();

// CORS global
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Api-Key',
    'X-AUTH',
    'PROJECT-KEY',
    'PLATFORM',
    'IDENTIFIER',
    'X-OpenGrow-Anonymous-ID',
    'X-OpenGrow-App-Version',
    'X-OpenGrow-SDK-Version',
    'X-OpenGrow-Storefront',
    'X-OpenGrow-Campaign',
    'Idempotency-Key',
    'ENVIRONMENT',
    'LINKSQUARED',
    'x-maintenance-key',
    'x-diagnostics-key',
  ],
}));

// Health check (tous les sous-domaines)
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'opengrow',
  environment: c.env.ENVIRONMENT,
  host: c.req.header('host'),
  timestamp: new Date().toISOString(),
}));

app.get('/health/billing', async (c) => {
  if (!c.env.BILLING) return c.json({ status: 'unavailable', service: 'opengrow-billing' }, 503);
  try {
    const response = await c.env.BILLING.fetch('https://billing.internal/internal/v1/health');
    const payload = JSON.parse(await readTextLimited(response, 16_384));
    return c.json({ ...payload, routing_mode: c.env.BILLING_EXECUTION_MODE || 'local' }, response.ok ? 200 : 503);
  } catch (error) {
    console.error(JSON.stringify({ event: 'billing_health_failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ status: 'unavailable', service: 'opengrow-billing', routing_mode: c.env.BILLING_EXECUTION_MODE || 'local' }, 503);
  }
});

app.get('/health/growth', async (c) => {
  if (!c.env.GROWTH) return c.json({ status: 'unavailable', service: 'opengrow-growth' }, 503);
  try {
    const response = await c.env.GROWTH.fetch('https://growth.internal/health');
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    console.error(JSON.stringify({ event: 'growth_health_failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ status: 'unavailable', service: 'opengrow-growth' }, 503);
  }
});

app.get('/up', (c) => c.text('OK', 200));
app.get('/favicon.ico', (c) => c.body(null, 204));

app.get('/.well-known/purchases-jwks.json', (c) => {
  try {
    return c.json(purchasesSigningJwks(c.env), 200, {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'purchases_jwks_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Purchases verification keys unavailable' }, 503);
  }
});

// =============================================
// Routing par sous-domaine (comme le vrai OpenGrow)
// =============================================
app.all('*', async (c, next) => {
  const host = c.req.header('host') || '';

  // sdk.vocostar.com — Mobile SDK
  if (host.startsWith('sdk.')) {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === '/api/v1/sdk' || pathname.startsWith('/api/v1/sdk/')) {
      return next();
    }
    return sdkRoutes.fetch(c.req.raw, c.env);
  }

  // go.vocostar.com — Short link redirects + well-known
  // (ou workers.dev pour tests)
  return next();
});

// =====================================
// Routes go.vocostar.com / workers.dev
// =====================================
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/users', usersRoutes);
app.route('/api/v1/instances', instancesRoutes);
app.route('/api/v1/projects', projectsRoutes);
app.route('/api/v1/mcp', mcpRoutes);
app.route('/api/v1/links', linksRoutes);
app.route('/api/v1/analytics', analyticsRoutes);
app.route('/api/v1/sdk', sdkRoutes);
app.route('/api/v1/webhooks', webhooksRoutes);
app.route('/api/v1/push', pushRoutes);
app.route('/api/v1/iap', iapRoutes);
app.use('/api/v1/identity/sso/*', async (c, next) => {
  if (!isSsoEnabled(c.env)) return c.notFound();
  return next();
});
app.route('/api/v1/identity/sso', identitySsoRoutes);
app.route('/api/v1/notifications', notificationsRoutes);
app.route('/api/v1/automation', automationRoutes);
app.route('/api/v1/diagnostics', diagnosticsRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/billing', purchasesAdminRoutes);
// The v2 admin surface is additive: existing catalogue/customer operations
// stay available while new resources use stable error envelopes.
app.route('/api/v2/purchases/projects', purchasesV2AdminRoutes);
app.route('/api/v2/purchases/projects', purchasesAdminRoutes);
app.route('/api/v2/purchases/providers/webhooks', purchasesProviderWebhooks);
app.route('/api/v2/reputation/projects', storeReviewsAdminRoutes);
app.route('/api/v2/messaging/projects', messagingAdminRoutes);
app.route('/api/v2/growth/projects', growthAdminRoutes);
app.route('/api/v2/inbox/projects', inboxAdminRoutes);
app.route('/oauth', oauthRoutes);
app.route('/.well-known', wellKnownRoutes);
app.route('', mcpOauthRoutes);

// Short link redirect — DOIT être en dernier
app.route('', redirectRoute);

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    if (env.BILLING_QUEUE) {
      ctx.waitUntil(env.BILLING_QUEUE.send({ type: 'billing.reconcile' }));
    }
    if (env.MAINTENANCE_QUEUE) {
      ctx.waitUntil(env.MAINTENANCE_QUEUE.send({ type: 'maintenance.run', days: 3 }));
      return;
    }
    ctx.waitUntil(
      runMaintenance(env).then((summary) => {
        console.log(JSON.stringify({ event: 'maintenance_completed', summary }));
      }).catch((error) => {
        console.error(JSON.stringify({ event: 'maintenance_failed', error: error?.message || String(error) }));
      }),
    );
  },
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      let body: any = null;
      try {
        body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
        const result = isBillingQueueJob(body) && billingServiceEnabled(env)
          ? await dispatchBillingServiceJob(env, body)
          : await dispatchQueueJob(env, body);
        console.log(JSON.stringify({
          event: 'queue_job_completed',
          queue: batch.queue,
          message_id: message.id,
          job_type: body?.type,
          result,
        }));
        message.ack();
        if (isBillingQueueJob(body) && env.GROWTH && env.GROWTH_INTERNAL_TOKEN && env.EVENT_QUEUE) {
          ctx.waitUntil(emitBillingGrowthEvent(env, body, result).catch((error) => {
            console.error(JSON.stringify({
              event: 'billing_growth_projection_failed',
              message_id: message.id,
              job_type: body.type,
              error: error instanceof Error ? error.message : String(error),
            }));
          }));
        }
      } catch (error: any) {
        console.error(JSON.stringify({
          event: 'queue_job_failed',
          queue: batch.queue,
          message_id: message.id,
          job_type: body?.type,
          error: error?.message || String(error),
        }));
        if (error?.retryable === false) message.ack();
        else message.retry({ delaySeconds: Math.max(30, Math.min(3600, Number(error?.retryDelaySeconds || 60))) });
      }
    }
  },
} satisfies ExportedHandler<Env>;
