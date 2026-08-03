import { Hono } from 'hono';
import { isFullAccess } from '../lib/deployment';
import { Env } from '../types';
import { generateShortCode } from '../lib/crypto';

const redirect = new Hono<{ Bindings: Env }>();

function requestOrigin(c: any) {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function dashboardUrl(c: any): string {
  return String(c.env.APP_URL || `https://${c.env.SHORTLINK_DOMAIN}`);
}

async function readBody(c: any): Promise<Record<string, any>> {
  const type = c.req.header('content-type') || '';
  if (type.includes('application/json')) return await c.req.json().catch(() => ({}));
  return await c.req.parseBody().catch(() => ({}));
}

function firstValue(body: Record<string, any>, ...names: string[]) {
  for (const name of names) {
    if (body[name] !== undefined) return body[name];
    const bracket = `quick_link[${name}]`;
    if (body[bracket] !== undefined) return body[bracket];
  }
  return undefined;
}

function sanitizeQuickLinkPath(value: string) {
  return value.trim().replace(/^\/+/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
}

function toBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isBotUserAgent(userAgent: string): boolean {
  return /bot|crawler|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|preview|headless|lighthouse/i.test(userAgent);
}

function parseLinkData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'string') return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function quickLinkPath(db: D1Database) {
  for (let i = 0; i < 20; i += 1) {
    const path = generateShortCode(5).toLowerCase();
    if (path === 'create') continue;
    const exists = await db.prepare('SELECT id FROM quick_links WHERE path = ? LIMIT 1').bind(path).first();
    if (!exists) return path;
  }
  throw new Error('Unable to generate quick link path');
}

async function defaultDomainId(c: any) {
  const db = c.env.DB as D1Database;
  const domain = await db.prepare(`
    SELECT id FROM domains
    WHERE domain = ? OR domain = ?
    ORDER BY CASE WHEN domain = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(c.env.SHORTLINK_DOMAIN, `https://${c.env.SHORTLINK_DOMAIN}`, c.env.SHORTLINK_DOMAIN).first<{ id: number }>();
  if (domain) return domain.id;

  const created = await db.prepare(`
    INSERT INTO domains (domain, subdomain)
    VALUES (?, 'go')
    RETURNING id
  `).bind(c.env.SHORTLINK_DOMAIN).first<{ id: number }>();
  if (!created) throw new Error('Unable to create default quick link domain');
  return created.id;
}

async function imageUrlFromBody(c: any, body: Record<string, any>) {
  const explicit = firstValue(body, 'image_url');
  if (explicit) return String(explicit);

  const file = firstValue(body, 'image');
  if (!file || typeof file === 'string') return null;
  if (!c.env.R2) throw new Error('R2 bucket is required to store quick link images');

  const name = String(file.name || 'quick-link-image').replace(/[^a-zA-Z0-9._-]/g, '-');
  const key = `quick-links/${crypto.randomUUID()}-${name}`;
  await c.env.R2.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { kind: 'quick_link_image' },
  });
  return `${requestOrigin(c)}/quick-link-assets/${encodeURIComponent(key)}`;
}

function serializeQuickLink(row: any, c: any) {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    subtitle: row.subtitle,
    image_url: row.image_url,
    ios_phone: row.ios_phone,
    ios_tablet: row.ios_tablet,
    android_phone: row.android_phone,
    android_tablet: row.android_tablet,
    desktop: row.desktop,
    desktop_linux: row.desktop_linux,
    desktop_mac: row.desktop_mac,
    desktop_windows: row.desktop_windows,
    access_path: `${requestOrigin(c)}/${row.path}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

redirect.get('/', async (c) => {
  return c.redirect(dashboardUrl(c), 302);
});

redirect.get('/public', async (c) => {
  return c.redirect(dashboardUrl(c), 302);
});

redirect.get('/quick-link-assets/*', async (c) => {
  if (!c.env.R2) return c.text('Not found', 404);
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/quick-link-assets\//, ''));
  const object = await c.env.R2.get(key);
  if (!object) return c.text('Not found', 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

redirect.post('/create', async (c) => {
  const body = await readBody(c);
  let imageUrl: string | null;
  try {
    imageUrl = await imageUrlFromBody(c, body);
  } catch (error: any) {
    return c.json({ error: error?.message || 'Unable to store quick link image' }, 503);
  }

  const path = await quickLinkPath(c.env.DB);
  const title = firstValue(body, 'title');
  const subtitle = firstValue(body, 'subtitle');
  const domainId = await defaultDomainId(c);
  const desktop = firstValue(body, 'desktop');

  const row = await c.env.DB.prepare(`
    INSERT INTO quick_links (
      id, domain_id, path, title, subtitle, image_url,
      ios_phone, ios_tablet, android_phone, android_tablet,
      desktop, desktop_linux, desktop_mac, desktop_windows,
      name, url, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    RETURNING *
  `).bind(
    crypto.randomUUID(),
    domainId,
    path,
    title ? String(title) : null,
    subtitle ? String(subtitle) : null,
    imageUrl,
    firstValue(body, 'ios_phone') ? String(firstValue(body, 'ios_phone')) : null,
    firstValue(body, 'ios_tablet') ? String(firstValue(body, 'ios_tablet')) : null,
    firstValue(body, 'android_phone') ? String(firstValue(body, 'android_phone')) : null,
    firstValue(body, 'android_tablet') ? String(firstValue(body, 'android_tablet')) : null,
    desktop ? String(desktop) : null,
    firstValue(body, 'desktop_linux') ? String(firstValue(body, 'desktop_linux')) : null,
    firstValue(body, 'desktop_mac') ? String(firstValue(body, 'desktop_mac')) : null,
    firstValue(body, 'desktop_windows') ? String(firstValue(body, 'desktop_windows')) : null,
    title ? String(title) : path,
    desktop ? String(desktop) : `${requestOrigin(c)}/${path}`,
  ).first<any>();

  return c.json({ link: serializeQuickLink(row, c) });
});

redirect.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '0.0.0.0';
  const userAgent = body.user_agent || c.req.header('User-Agent') || '';
  const device = await c.env.DB.prepare(`
    INSERT INTO devices (
      ip, remote_ip, user_agent, platform, model, vendor, language, timezone,
      screen_width, screen_height, app_version, build, webgl_vendor, webgl_renderer
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    ip,
    ip,
    userAgent,
    body.platform || null,
    body.model || null,
    body.vendor || body.vendor_id || null,
    body.language || null,
    body.timezone || null,
    body.screen_width || null,
    body.screen_height || null,
    body.app_version || null,
    body.build || null,
    body.webgl_vendor || null,
    body.webgl_renderer || null,
  ).first<{ id: number }>();
  return c.json({ device_id: device?.id || null });
});

async function marketingMessageResponse(c: any, id: string) {
  const db = c.env.DB as D1Database;
  const notification = await db.prepare(
    'SELECT html FROM notifications WHERE id = ? AND COALESCE(archived, 0) = 0 LIMIT 1'
  ).bind(id).first<{ html: string | null }>();
  if (!notification) {
    return c.text('Not found', 404);
  }
  return c.html(sanitizeMarketingHtml(notification.html || ''));
}

redirect.get('/mm/*', async (c) => {
  const id = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/mm\/+/, ''));
  return marketingMessageResponse(c, id);
});

redirect.get('/mm/:id', async (c) => {
  return marketingMessageResponse(c, c.req.param('id'));
});

async function quickLinkResponse(c: any, path: string) {
  const db = c.env.DB as D1Database;
  const quickLink = await db.prepare('SELECT * FROM quick_links WHERE path = ? LIMIT 1')
    .bind(sanitizeQuickLinkPath(path)).first<any>();
  if (!quickLink) return null;

  const userAgent = c.req.header('User-Agent') || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const targetUrl = (isIOS && (quickLink.ios_phone || quickLink.ios_tablet))
    || (isAndroid && (quickLink.android_phone || quickLink.android_tablet))
    || quickLink.desktop
    || quickLink.desktop_mac
    || quickLink.desktop_windows
    || quickLink.desktop_linux;

  if (targetUrl) return c.redirect(String(targetUrl), 302);

  return c.html(generateQuickLinkPage(quickLink, `${requestOrigin(c)}/${quickLink.path}`));
}

// GET /:code — résolution et redirection d'un lien court
redirect.get('/:code', async (c) => {
  const code = c.req.param('code');
  const quickLink = await quickLinkResponse(c, code);
  if (quickLink) return quickLink;

  const userAgent = c.req.header('User-Agent') || '';
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '0.0.0.0';
  const url = new URL(c.req.url);
  const goToFallback = toBool(url.searchParams.get('go_to_fallback'));
  const opengrowRedirect = url.searchParams.get('opengrow_redirect');
  const isBot = isBotUserAgent(userAgent);

  const link = await c.env.DB.prepare(`
    SELECT l.*, rc.default_fallback, rc.project_id,
           rc.show_preview_ios AS config_show_preview_ios,
           rc.show_preview_android AS config_show_preview_android,
           p.name AS project_name,
           p.instance_id,
           i.uri_scheme,
           COALESCE(i.quota_exceeded, 0) AS quota_exceeded,
           d.generic_title, d.generic_subtitle, d.generic_image_url
    FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    JOIN projects p ON p.id = rc.project_id
    JOIN instances i ON i.id = p.instance_id
    LEFT JOIN domains d ON d.id = l.domain_id
    WHERE l.path = ? AND l.active = 1
  `).bind(code).first<{
    id: number; path: string; redirect_config_id: number; title: string | null; subtitle: string | null;
    image_url: string | null; data: string | null; default_fallback: string | null;
    project_id: number; instance_id: number; project_name: string | null; uri_scheme: string | null;
    show_preview_ios: number | null; show_preview_android: number | null;
    config_show_preview_ios: number | null; config_show_preview_android: number | null;
    quota_exceeded: number; generic_title: string | null; generic_subtitle: string | null; generic_image_url: string | null;
  }>();

  if (!link) {
    return c.redirect(dashboardUrl(c), 302);
  }

  if (!isFullAccess(c.env) && link.quota_exceeded === 1) {
    return c.html(generateQuotaExceededPage(link.project_name || 'OpenGrow'), 402);
  }

  // Detect platform
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'web';

  let device = await c.env.DB.prepare(`
    SELECT id FROM devices
    WHERE ip = ? AND user_agent = ?
      AND datetime(updated_at) >= datetime('now', '-24 hours')
    ORDER BY datetime(updated_at) DESC
    LIMIT 1
  `).bind(ip, userAgent).first<{ id: number }>();
  if (device) {
    await c.env.DB.prepare('UPDATE devices SET remote_ip = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(ip, device.id).run();
  } else {
    device = await c.env.DB.prepare(
      "INSERT INTO devices (ip, remote_ip, user_agent, platform) VALUES (?, ?, ?, ?) RETURNING id"
    ).bind(ip, ip, userAgent, platform).first<{ id: number }>();
  }

  if (device) {
    await c.env.DB.prepare(`
      INSERT INTO actions (device_id, link_id)
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM actions
        WHERE device_id = ? AND link_id = ? AND handled = 0
      )
    `).bind(device.id, link.id, device.id, link.id).run();

    if (!goToFallback && !opengrowRedirect && !isBot) {
      await c.env.DB.prepare(
        "INSERT INTO events (device_id, project_id, link_id, event, platform, ip) VALUES (?, ?, ?, 'view', ?, ?)"
      ).bind(device.id, link.project_id, link.id, platform, ip).run();
    }
  }

  // Find platform-specific redirect URL
  const customRedirect = await c.env.DB.prepare(
    'SELECT url, open_app_if_installed FROM custom_redirects WHERE link_id = ? AND platform = ?'
  ).bind(link.id, platform).first<{ url: string | null; open_app_if_installed: number | null }>();

  const platformRedirect = await c.env.DB.prepare(`
    SELECT fallback_url, appstore
    FROM redirects
    WHERE redirect_config_id = ? AND platform = ? AND COALESCE(enabled, 1) = 1
    ORDER BY CASE WHEN variation = 'phone' THEN 0 WHEN variation = 'tablet' THEN 1 ELSE 2 END
    LIMIT 1
  `).bind(link.redirect_config_id, platform).first<{ fallback_url: string | null; appstore: number | null }>();

  const linkData = parseLinkData(link.data);
  const deeplink = String(linkData.appLink || linkData.deeplink || `${link.uri_scheme || 'opengrow'}://${link.path}`);
  let targetUrl = customRedirect?.url || platformRedirect?.fallback_url || link.default_fallback;
  if (!targetUrl && platformRedirect?.appstore === 1) {
    targetUrl = isAndroid ? await googlePlayUrl(c.env.DB, Number(link.instance_id)) : 'https://apps.apple.com';
  }

  // Show preview page for mobile if configured
  const showPreview = (isIOS && (link.show_preview_ios ?? link.config_show_preview_ios))
    || (isAndroid && (link.show_preview_android ?? link.config_show_preview_android));

  if (showPreview && !goToFallback && link.title) {
    // Return HTML preview page with smart banner
    const previewHtml = generatePreviewPage(link, targetUrl || '#', platform);
    return c.html(previewHtml);
  }

  if (goToFallback && targetUrl) return c.redirect(targetUrl, 302);

  if (!targetUrl) {
    // Fallback to App Store / Play Store if no URL configured
    if (isIOS) targetUrl = 'https://apps.apple.com';
    else if (isAndroid) targetUrl = 'https://play.google.com';
    else targetUrl = dashboardUrl(c);
  }

  if (isIOS || isAndroid) {
    return c.html(generatePlatformHandlingPage({
      title: link.title || link.generic_title || link.project_name || 'OpenGrow',
      subtitle: link.subtitle || link.generic_subtitle || '',
      imageUrl: link.image_url || link.generic_image_url || '',
      deeplink,
      fallbackUrl: targetUrl,
      platform,
      accessPath: `${requestOrigin(c)}/${link.path}`,
    }));
  }

  return c.html(generateDesktopHandlingPage({
    title: link.title || link.generic_title || link.project_name || 'OpenGrow',
    subtitle: link.subtitle || link.generic_subtitle || '',
    imageUrl: link.image_url || link.generic_image_url || '',
    fallbackUrl: targetUrl,
    accessPath: `${requestOrigin(c)}/${link.path}`,
  }));
});

redirect.get('/*', async (c) => {
  const path = new URL(c.req.url).pathname.replace(/^\/+/, '');
  if (!path) return c.redirect(dashboardUrl(c), 302);
  const quickLink = await quickLinkResponse(c, path);
  if (quickLink) return quickLink;
  return c.redirect(dashboardUrl(c), 302);
});

function sanitizeMarketingHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*(javascript|data):[^'"]*\2/gi, '');
}

function generatePreviewPage(link: {
  title: string | null; subtitle: string | null; image_url: string | null; path: string
}, targetUrl: string, platform: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${link.title || 'Ouvrir'}</title>
  <meta property="og:title" content="${link.title || ''}">
  <meta property="og:description" content="${link.subtitle || ''}">
  ${link.image_url ? `<meta property="og:image" content="${link.image_url}">` : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #000; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { max-width: 400px; width: 90%; text-align: center; padding: 40px 20px; }
    img { width: 120px; height: 120px; border-radius: 24px; object-fit: cover; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 16px; color: #999; margin-bottom: 32px; }
    a { display: block; background: #fff; color: #000; padding: 16px 24px; border-radius: 12px; font-size: 17px; font-weight: 600; text-decoration: none; }
  </style>
  <script>setTimeout(() => { window.location.href = "${targetUrl}"; }, 2000);</script>
</head>
<body>
  <div class="card">
    ${link.image_url ? `<img src="${link.image_url}" alt="">` : ''}
    <h1>${link.title || 'Ouvrir'}</h1>
    ${link.subtitle ? `<p>${link.subtitle}</p>` : ''}
    <a href="${targetUrl}">Ouvrir ${platform === 'ios' ? "l'App Store" : 'le Play Store'}</a>
  </div>
</body>
</html>`;
}

async function googlePlayUrl(db: D1Database, instanceId: number): Promise<string> {
  const row = await db.prepare(`
    SELECT ac.identifier
    FROM applications a
    JOIN android_configurations ac ON ac.application_id = a.id
    WHERE a.instance_id = ? AND a.platform = 'android'
    LIMIT 1
  `).bind(instanceId).first<{ identifier: string }>();
  return row?.identifier ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(row.identifier)}` : 'https://play.google.com';
}

function generateQuotaExceededPage(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quota exceeded</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { width: min(440px, calc(100vw - 32px)); text-align: center; }
    h1 { font-size: 24px; margin: 0 0 10px; }
    p { color: #4b5563; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>Link temporarily unavailable</h1>
    <p>${escapeHtml(name)} has exceeded its current usage quota.</p>
  </main>
</body>
</html>`;
}

function generatePlatformHandlingPage(config: {
  title: string;
  subtitle: string;
  imageUrl: string;
  deeplink: string;
  fallbackUrl: string;
  platform: string;
  accessPath: string;
}): string {
  const title = escapeHtml(config.title);
  const subtitle = escapeHtml(config.subtitle);
  const image = config.imageUrl ? escapeHtml(config.imageUrl) : '';
  const deeplink = JSON.stringify(config.deeplink);
  const fallback = JSON.stringify(config.fallbackUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${subtitle}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta property="og:url" content="${escapeHtml(config.accessPath)}">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #ffffff; }
    main { width: min(420px, calc(100vw - 32px)); text-align: center; }
    img { width: 112px; height: 112px; object-fit: cover; border-radius: 22px; margin-bottom: 22px; }
    h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; }
    p { color: #4b5563; line-height: 1.5; margin: 0 0 26px; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 8px; background: #111827; color: white; text-decoration: none; font-weight: 600; }
  </style>
  <script>
    const fallback = ${fallback};
    window.location.href = ${deeplink};
    setTimeout(() => { window.location.href = fallback; }, ${config.platform === 'ios' ? 1500 : 900});
  </script>
</head>
<body>
  <main>
    ${image ? `<img src="${image}" alt="">` : ''}
    <h1>${title}</h1>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
    <a href="${escapeHtml(config.fallbackUrl)}">Continue</a>
  </main>
</body>
</html>`;
}

function generateDesktopHandlingPage(config: {
  title: string;
  subtitle: string;
  imageUrl: string;
  fallbackUrl: string;
  accessPath: string;
}): string {
  const title = escapeHtml(config.title);
  const subtitle = escapeHtml(config.subtitle);
  const image = config.imageUrl ? escapeHtml(config.imageUrl) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${subtitle}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta property="og:url" content="${escapeHtml(config.accessPath)}">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { width: min(460px, calc(100vw - 32px)); text-align: center; }
    img { width: 112px; height: 112px; object-fit: cover; border-radius: 22px; margin-bottom: 22px; }
    h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; }
    p { color: #4b5563; line-height: 1.5; margin: 0 0 26px; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 8px; background: #111827; color: white; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    ${image ? `<img src="${image}" alt="">` : ''}
    <h1>${title}</h1>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
    <a href="${escapeHtml(config.fallbackUrl)}">Continue</a>
  </main>
</body>
</html>`;
}

function generateQuickLinkPage(link: any, accessPath: string): string {
  const title = escapeHtml(link.title || 'opengrow');
  const subtitle = escapeHtml(link.subtitle || 'Dynamic links, attributions, and referrals across mobile and web platforms.');
  const image = link.image_url ? String(link.image_url) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${subtitle}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
  <meta property="og:url" content="${escapeHtml(accessPath)}">
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: grid; place-items: center; background: #f7f7f8; color: #111827; }
    main { width: min(420px, calc(100vw - 32px)); text-align: center; }
    img { width: 120px; height: 120px; object-fit: cover; border-radius: 24px; margin-bottom: 24px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { color: #4b5563; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    ${image ? `<img src="${escapeHtml(image)}" alt="">` : ''}
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default redirect;
