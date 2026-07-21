import { Env } from '../types';

type CsvExportOptions = {
  projectId?: number | string | null;
  applicationId?: number | string | null;
  prefix: string;
  csv: string;
  expiresInSeconds?: number;
};

function requestOrigin(c: any) {
  const host = c.req.header('host') || new URL(c.req.url).host;
  const proto = host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function csvFileName(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${crypto.randomUUID()}.csv`;
}

export async function storeCsvDownload(c: any, options: CsvExportOptions): Promise<{ name: string; key: string; url: string }> {
  const env = c.env as Env;
  if (!env.R2) {
    throw new Error('R2 bucket is not configured');
  }

  const expiresInSeconds = options.expiresInSeconds ?? 24 * 60 * 60;
  const name = csvFileName(options.prefix);
  const key = name;
  const bytes = new TextEncoder().encode(options.csv);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  await env.R2.put(key, bytes, {
    httpMetadata: {
      contentType: 'text/csv; charset=utf-8',
      contentDisposition: `attachment; filename="${name}"`,
    },
    customMetadata: {
      expiresAt,
      kind: 'downloadable_file',
    },
  });

  await env.DB.prepare(`
    INSERT INTO downloadable_files (project_id, application_id, name, file_key, content_type, byte_size)
    VALUES (?, ?, ?, ?, 'text/csv', ?)
  `).bind(
    options.projectId ? String(options.projectId) : null,
    options.applicationId ? String(options.applicationId) : null,
    name,
    key,
    bytes.byteLength,
  ).run();

  return {
    name,
    key,
    url: `${requestOrigin(c)}/api/v1/projects/exports/${encodeURIComponent(key)}`,
  };
}

export async function readCsvDownload(env: Env, key: string): Promise<Response | null> {
  if (!env.R2) throw new Error('R2 bucket is not configured');
  const object = await env.R2.get(key);
  if (!object) return null;

  const expiresAt = object.customMetadata?.expiresAt;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    await env.R2.delete(key).catch(() => undefined);
    return null;
  }

  const filename = key.split('/').pop() || 'export.csv';
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'text/csv; charset=utf-8',
      'content-disposition': object.httpMetadata?.contentDisposition || `attachment; filename="${filename}"`,
      'cache-control': 'private, max-age=0, no-store',
    },
  });
}
