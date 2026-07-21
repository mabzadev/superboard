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
import redirectRoute from './routes/redirect';
import { runMaintenance } from './lib/maintenance';
import { dispatchQueueJob } from './lib/jobs';

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

app.get('/up', (c) => c.text('OK', 200));
app.get('/favicon.ico', (c) => c.body(null, 204));

// =============================================
// Routing par sous-domaine (comme le vrai OpenGrow)
// =============================================
app.all('*', async (c, next) => {
  const host = c.req.header('host') || '';

  // sdk.vocostar.com — Mobile SDK
  if (host.startsWith('sdk.')) {
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
app.route('/api/v1/identity/sso', identitySsoRoutes);
app.route('/api/v1/notifications', notificationsRoutes);
app.route('/api/v1/automation', automationRoutes);
app.route('/api/v1/diagnostics', diagnosticsRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/billing', purchasesAdminRoutes);
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
  async queue(batch, env) {
    for (const message of batch.messages) {
      let body: any = null;
      try {
        body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
        const result = await dispatchQueueJob(env, body);
        console.log(JSON.stringify({
          event: 'queue_job_completed',
          queue: batch.queue,
          message_id: message.id,
          job_type: body?.type,
          result,
        }));
        message.ack();
      } catch (error: any) {
        console.error(JSON.stringify({
          event: 'queue_job_failed',
          queue: batch.queue,
          message_id: message.id,
          job_type: body?.type,
          error: error?.message || String(error),
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
