import { Hono } from 'hono';
import { Env } from '../types';

const wellKnown = new Hono<{ Bindings: Env }>();

wellKnown.get('/oauth-protected-resource', async (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    resource: origin,
    authorization_servers: [`${origin}/.well-known/oauth-authorization-server`],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/api/v1/mcp/status`,
  });
});

wellKnown.get('/oauth-authorization-server', async (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    registration_endpoint: `${origin}/register`,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
  });
});

// iOS Universal Links — Apple App Site Association
wellKnown.get('/apple-app-site-association', async (c) => {
  const domain = c.req.header('host') || c.env.SHORTLINK_DOMAIN;

  // Fetch all iOS configs
  const { results: iosConfigs } = await c.env.DB.prepare(`
    SELECT ic.bundle_id, ic.app_prefix
    FROM ios_configurations ic
    JOIN applications a ON a.id = ic.application_id
    WHERE ic.bundle_id IS NOT NULL
  `).all<{ bundle_id: string; app_prefix: string }>();

  const appIds = [...new Set(iosConfigs.map(c => `${c.app_prefix}.${c.bundle_id}`))];
  if (appIds.length === 0) {
    return c.json({ error: 'Configuration not set', domain }, 404);
  }

  const aasa = {
    applinks: {
      apps: [],
      details: appIds.map(appId => ({
        appID: appId,
        paths: ['*']
      }))
    }
  };

  return c.json(aasa, 200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  });
});

// Android App Links — Asset Links
wellKnown.get('/assetlinks.json', async (c) => {
  const { results: androidConfigs } = await c.env.DB.prepare(`
    SELECT ac.identifier, ac.sha256s
    FROM android_configurations ac
    JOIN applications a ON a.id = ac.application_id
  `).all<{ identifier: string; sha256s: string }>();

  const seen = new Set<string>();
  const assetLinks = androidConfigs
    .filter((config) => {
      const key = `${config.identifier}:${config.sha256s}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(config => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: config.identifier,
      sha256_cert_fingerprints: JSON.parse(config.sha256s || '[]')
    }
  }));

  if (assetLinks.length === 0) {
    return c.json({ error: 'Configuration not set' }, 404);
  }

  return c.json(assetLinks, 200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  });
});

export default wellKnown;
