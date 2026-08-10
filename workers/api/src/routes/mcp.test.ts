import { describe, expect, it } from 'vitest';
import { Env } from '../types';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';
import mcp from './mcp';

function mcpDatabase(extra: (call: FakeD1Call) => unknown = () => undefined) {
  return createFakeD1((call) => {
    const { op, sql } = call;
    if (op === 'first' && sql.includes('SELECT user_id FROM mcp_tokens')) return { user_id: 7 };
    if (op === 'run' && sql.includes('UPDATE mcp_tokens SET last_used_at')) return true;
    return extra(call);
  });
}

function env(db: D1Database): Env {
  return {
    DB: db,
    SHORTLINK_DOMAIN: 'links.example.test',
  } as Env;
}

describe('MCP back-office contract', () => {
  it('returns normalized instances and project IDs without an API key', async () => {
    const db = mcpDatabase(({ op, sql }) => {
      if (op === 'first' && sql.includes('SELECT id, email, name FROM users')) {
        return { id: 7, email: 'operator@example.test', name: 'Operator' };
      }
      if (op === 'all' && sql.includes('COUNT(DISTINCT p.id) AS projects_count')) {
        return [{ id: 10, uri_scheme: 'sample', projects_count: 2, links_count: 4 }];
      }
      if (op === 'all' && sql.includes('FROM projects') && sql.includes('WHERE instance_id = ?')) {
        return [
          { id: 101, name: 'Sample', identifier: 'sample_prod_10', is_test: 0 },
          { id: 102, name: 'Sample Test', identifier: 'sample_test_10', is_test: 1 },
        ];
      }
      return undefined;
    });

    const response = await mcp.request('/status', {
      headers: { Authorization: 'Bearer mcp_token' },
    }, env(db));

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body).toEqual({
      user: { id: 7, email: 'operator@example.test', name: 'Operator' },
      instances: [{
        id: '10',
        uri_scheme: 'sample',
        projects_count: 2,
        links_count: 4,
        projects: [
          { id: '10-prod', name: 'Sample', identifier: 'sample_prod_10', environment: 'production' },
          { id: '10-test', name: 'Sample Test', identifier: 'sample_test_10', environment: 'test' },
        ],
      }],
    });
    expect(JSON.stringify(body)).not.toContain('api_key');
  });

  it('reports activity without quota or OpenGrow subscription fields', async () => {
    const db = mcpDatabase(({ op, sql }) => {
      if (op === 'first' && sql.includes('SELECT * FROM instances WHERE id = ?')) return { id: 10 };
      if (op === 'first' && sql.includes('FROM instance_roles')) return { id: 1 };
      if (op === 'first' && sql.includes('COUNT(DISTINCT e.device_id) AS total')) return { total: 123 };
      return undefined;
    });

    const response = await mcp.request('/usage?instance_id=10', {
      headers: { Authorization: 'Bearer mcp_token' },
    }, env(db));

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body).toEqual({ usage: { instance_id: '10', mau: 123 } });
    expect(JSON.stringify(body)).not.toMatch(/quota|subscription|limit/iu);
  });

  it('creates normalized project references without returning the generated instance key', async () => {
    const db = mcpDatabase(({ op, sql, args }) => {
      if (op === 'first' && sql.includes('INSERT INTO instances')) {
        return { id: 10, api_key: 'must-not-leave-the-api', uri_scheme: 'sample' };
      }
      if (op === 'run' && sql.includes('INSERT INTO instance_roles')) return true;
      if (op === 'first' && sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) {
        const isTest = Number(args[1]) === 1;
        return {
          id: isTest ? 102 : 101,
          name: isTest ? 'Sample Test' : 'Sample',
          identifier: isTest ? 'sample_test_10' : 'sample_prod_10',
          instance_id: 10,
          is_test: isTest ? 1 : 0,
        };
      }
      return undefined;
    });

    const response = await mcp.request('/projects', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mcp_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Sample' }),
    }, env(db));

    expect(response.status).toBe(201);
    const body = await response.json<any>();
    expect(body).toMatchObject({
      instance: {
        id: '10',
        uri_scheme: 'sample',
        production: { id: '10-prod' },
        test: { id: '10-test' },
      },
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leave-the-api');
    expect(JSON.stringify(body)).not.toContain('api_key');
  });
});
