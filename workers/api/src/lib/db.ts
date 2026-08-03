import { Env } from '../types';
import { generateApiKey } from './crypto';
import { getAuthUserId as getStrictAuthUserId } from './auth';
import { HTTPException } from 'hono/http-exception';

export type ProjectKind = 'production' | 'test';

export interface ProjectRef {
  id: number;
  externalId: string;
  name: string;
  identifier: string;
  instanceId: number;
  isTest: boolean;
}

export function parseProjectExternalId(raw: string): { instanceId: number; kind: ProjectKind } {
  const isTest = raw.endsWith('-test');
  const numeric = raw.replace(/-prod$|-test$/, '');
  const instanceId = Number(numeric);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new HTTPException(400, { message: `Invalid project id: ${raw}` });
  }
  return { instanceId, kind: isTest ? 'test' : 'production' };
}

export async function getPrimaryInstanceId(db: D1Database, userId: number): Promise<number | null> {
  const role = await db.prepare(
    'SELECT instance_id FROM instance_roles WHERE user_id = ? ORDER BY id ASC LIMIT 1'
  ).bind(userId).first<{ instance_id: number }>();
  return role?.instance_id ?? null;
}

export async function getOrCreateInstanceForUser(
  db: D1Database,
  userId: number,
  name = 'Vocostar',
  revenueCollectionEnabled = false,
): Promise<number> {
  const current = await getPrimaryInstanceId(db, userId);
  if (current) return current;

  const apiKey = generateApiKey();
  const uriScheme = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${Date.now().toString(36)}`;
  const created = await db.prepare(
    'INSERT INTO instances (api_key, uri_scheme, revenue_collection_enabled) VALUES (?, ?, ?) RETURNING id'
  ).bind(apiKey, uriScheme, revenueCollectionEnabled ? 1 : 0).first<{ id: number }>();

  if (!created) throw new Error('Unable to create instance');

  await db.prepare(
    'INSERT INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)'
  ).bind(userId, created.id, 'owner').run();

  await getOrCreateProject(db, created.id, 'production');
  await getOrCreateProject(db, created.id, 'test');
  return created.id;
}

export async function getOrCreateProject(db: D1Database, instanceId: number, kind: ProjectKind): Promise<ProjectRef> {
  const isTest = kind === 'test';
  const existing = await db.prepare(
    'SELECT id, name, identifier, instance_id, is_test FROM projects WHERE instance_id = ? AND is_test = ? LIMIT 1'
  ).bind(instanceId, isTest ? 1 : 0).first<{
    id: number;
    name: string;
    identifier: string;
    instance_id: number;
    is_test: number;
  }>();

  if (existing) {
    return {
      id: existing.id,
      externalId: `${instanceId}-${isTest ? 'test' : 'prod'}`,
      name: existing.name,
      identifier: existing.identifier,
      instanceId: existing.instance_id,
      isTest: existing.is_test === 1,
    };
  }

  const instance = await db.prepare(
    'SELECT uri_scheme FROM instances WHERE id = ?'
  ).bind(instanceId).first<{ uri_scheme: string }>();
  if (!instance) {
    throw new HTTPException(404, { message: `Project instance not found: ${instanceId}` });
  }

  const baseName = instance.uri_scheme || `instance-${instanceId}`;
  const name = isTest ? `${baseName} Test` : baseName;
  const identifier = `${baseName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${isTest ? 'test' : 'prod'}_${instanceId}`;

  const created = await db.prepare(
    'INSERT INTO projects (name, identifier, instance_id, is_test) VALUES (?, ?, ?, ?) RETURNING id, name, identifier, instance_id, is_test'
  ).bind(name, identifier, instanceId, isTest ? 1 : 0).first<{
    id: number;
    name: string;
    identifier: string;
    instance_id: number;
    is_test: number;
  }>();

  if (!created) throw new Error('Unable to create project');

  await getOrCreateRedirectConfig(db, created.id);

  return {
    id: created.id,
    externalId: `${instanceId}-${isTest ? 'test' : 'prod'}`,
    name: created.name,
    identifier: created.identifier,
    instanceId: created.instance_id,
    isTest: created.is_test === 1,
  };
}

export async function resolveProject(db: D1Database, externalId: string): Promise<ProjectRef> {
  const parsed = parseProjectExternalId(externalId);
  return getOrCreateProject(db, parsed.instanceId, parsed.kind);
}

export async function getOrCreateRedirectConfig(db: D1Database, projectId: number): Promise<number> {
  const existing = await db.prepare(
    'SELECT id FROM redirect_configs WHERE project_id = ? LIMIT 1'
  ).bind(projectId).first<{ id: number }>();
  if (existing) return existing.id;

  const created = await db.prepare(
    'INSERT INTO redirect_configs (project_id, default_fallback) VALUES (?, ?) RETURNING id'
  ).bind(projectId, '').first<{ id: number }>();
  if (!created) throw new Error('Unable to create redirect config');
  return created.id;
}

export async function getAuthUserId(env: Env, authHeader: string | undefined): Promise<number | null> {
  return getStrictAuthUserId(env, authHeader);
}

export function jsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(Array.isArray(parsed) ? parsed : [value]);
    } catch {
      return JSON.stringify(value ? [value] : []);
    }
  }
  return JSON.stringify([]);
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
