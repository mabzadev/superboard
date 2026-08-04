import type { Env } from './types';
import { AUTOMATION_TRIGGERS, AUTOMATION_TRIGGER_ACTIONS } from './types';
import { automationConfig, failure, jsonObject, requiredString } from './validation';
import { audit } from './sync';

type AutomationRow = {
  id: string;
  project_id: number;
  trigger_type: string;
  action_type: 'chat' | 'push' | 'in_app' | 'inbox';
  trigger_config_json: string;
  action_config_json: string;
};

export async function evaluateEvent(env: Env, projectId: number, input: Record<string, unknown>) {
  const providerEventId = requiredString(input.event_id, 'event_id', 255);
  const eventType = requiredString(input.event_type, 'event_type', 64);
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(eventType)) {
    throw failure('event_type_invalid', 'Unsupported growth event type');
  }
  const subjectId = input.subject_id == null ? null : requiredString(input.subject_id, 'subject_id', 255);
  const payload = jsonObject(input.payload, 'payload');
  const occurredAt = input.occurred_at == null ? new Date().toISOString() : validDate(input.occurred_at);
  const eventId = crypto.randomUUID();
  const inserted = await env.DB.prepare(`
    INSERT INTO growth_events (id, project_id, provider_event_id, event_type, subject_id, occurred_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, provider_event_id) DO NOTHING
  `).bind(eventId, projectId, providerEventId, eventType, subjectId, occurredAt, JSON.stringify(payload)).run();
  const event = await env.DB.prepare(`
    SELECT id, event_type, subject_id, occurred_at, payload_json, processed_at FROM growth_events
    WHERE project_id = ? AND provider_event_id = ?
  `).bind(projectId, providerEventId).first<Record<string, unknown>>();
  if (!event) throw failure('event_persistence_failed', 'Unable to persist the growth event', 503, true);
  if (inserted.meta.changes === 0 && !sameEventIdentity(event, eventType, subjectId, payload)) {
    throw failure('growth_event_identity_conflict', 'The event ID is already associated with different event data', 409, false);
  }
  if (event.processed_at == null) {
    const automations = await env.DB.prepare(`
      SELECT * FROM growth_automations WHERE project_id = ? AND enabled = 1 AND trigger_type = ? ORDER BY id
    `).bind(projectId, eventType).all<AutomationRow>();
    for (const automation of automations.results) {
      if (!(AUTOMATION_TRIGGER_ACTIONS[eventType as keyof typeof AUTOMATION_TRIGGER_ACTIONS] || []).includes(automation.action_type)) continue;
      const triggerConfig = automationConfig(parseObject(automation.trigger_config_json), 'trigger_config');
      if (!matchesAutomation(triggerConfig, payload)) continue;
      const actionConfig = automationConfig(parseObject(automation.action_config_json), 'action_config');
      const actionPayload = {
        channel: automation.action_type,
        subject_id: subjectId,
        message: actionConfig,
        event: { id: event.id, type: eventType, occurred_at: occurredAt, payload },
      };
      await env.DB.prepare(`
        INSERT INTO growth_automation_runs (
          id, project_id, automation_id, event_id, action_payload_json
        ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(automation_id, event_id) DO NOTHING
      `).bind(crypto.randomUUID(), projectId, automation.id, event.id, JSON.stringify(actionPayload)).run();
    }
    const processed = await env.DB.prepare(`
      UPDATE growth_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL
    `).bind(event.id).run();
    if (processed.meta.changes > 0) {
      await audit(env, projectId, 'growth.event.processed', 'event', String(event.id), {
        provider_event_id: providerEventId, event_type: eventType,
      });
    }
  }
  const runs = await env.DB.prepare(`
    SELECT r.id, r.status, r.action_payload_json, a.action_type, a.name AS automation_name
    FROM growth_automation_runs r JOIN growth_automations a ON a.id = r.automation_id
    WHERE r.event_id = ? ORDER BY r.created_at
  `).bind(event.id).all<Record<string, unknown>>();
  return {
    duplicate: inserted.meta.changes === 0,
    event_id: event.id,
    actions: runs.results.map((row) => ({
      id: row.id,
      status: row.status,
      action_type: row.action_type,
      automation_name: row.automation_name,
      payload: parseObject(String(row.action_payload_json || '{}')),
    })),
  };
}

export async function markRun(env: Env, projectId: number, runId: string, input: Record<string, unknown>) {
  const status = requiredString(input.status, 'status', 32);
  if (!['delivered', 'failed', 'cancelled'].includes(status)) throw failure('status_invalid', 'status must be delivered, failed or cancelled');
  const claimToken = requiredString(input.claim_token, 'claim_token', 64);
  const lastError = input.last_error == null ? null : requiredString(input.last_error, 'last_error', 2000);
  const run = await env.DB.prepare(`
    UPDATE growth_automation_runs SET status = ?, last_error = ?, claimed_at = NULL,
      claim_token = NULL, claim_expires_at = NULL, next_attempt_at = NULL,
      delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END,
      updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND status = 'pending' AND claim_token = ?
    RETURNING id, status
  `).bind(status, lastError, status, runId, projectId, claimToken).first<Record<string, unknown>>();
  if (!run) return failedLeaseMutation(env, projectId, runId);
  await audit(env, projectId, `growth.automation_run.${status}`, 'automation_run', runId, { last_error: lastError });
  return run;
}

export async function claimRun(env: Env, projectId: number, runId: string) {
  const current = await automationRun(env, projectId, runId);
  if (!current) throw failure('automation_run_not_found', 'Automation run not found', 404, false);
  if (current.status !== 'pending') return { ...current, terminal: true };
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE growth_automation_runs SET claim_token = ?, claimed_at = datetime('now'),
      claim_expires_at = datetime('now', '+10 minutes'), next_attempt_at = NULL,
      attempt_count = attempt_count + 1, updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
      AND (claimed_at IS NULL OR COALESCE(claim_expires_at, datetime(claimed_at, '+5 minutes')) <= datetime('now'))
    RETURNING id
  `).bind(claimToken, runId, projectId).first<Record<string, unknown>>();
  if (!claimed) throw failure('automation_run_busy', 'Automation run is already being delivered', 409, true, 30);
  const run = await automationRun(env, projectId, runId);
  await audit(env, projectId, 'growth.automation_run.claimed', 'automation_run', runId, {
    attempt_count: run?.attempt_count,
  });
  return { ...run, claim_token: claimToken, terminal: false };
}

export async function releaseRun(env: Env, projectId: number, runId: string, input: Record<string, unknown>) {
  const lastError = requiredString(input.last_error, 'last_error', 2000);
  const claimToken = requiredString(input.claim_token, 'claim_token', 64);
  const requestedRetryAfter = Number(input.retry_after_seconds || 60);
  const retryAfter = Number.isFinite(requestedRetryAfter) ? Math.max(30, Math.min(3600, Math.floor(requestedRetryAfter))) : 60;
  const run = await env.DB.prepare(`
    UPDATE growth_automation_runs SET claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL, last_error = ?,
      next_attempt_at = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND status = 'pending' AND claim_token = ?
    RETURNING id, status, attempt_count, next_attempt_at
  `).bind(lastError, retryAfter, runId, projectId, claimToken).first<Record<string, unknown>>();
  if (!run) return failedLeaseMutation(env, projectId, runId);
  await audit(env, projectId, 'growth.automation_run.retry_scheduled', 'automation_run', runId, {
    last_error: lastError, retry_after_seconds: retryAfter,
  });
  return run;
}

async function automationRun(env: Env, projectId: number, runId: string) {
  return env.DB.prepare(`
    SELECT r.id, r.project_id, r.status, r.action_payload_json, r.attempt_count,
      r.claimed_at, r.next_attempt_at, r.delivered_at, a.action_type, a.name AS automation_name
    FROM growth_automation_runs r JOIN growth_automations a ON a.id = r.automation_id
    WHERE r.id = ? AND r.project_id = ?
  `).bind(runId, projectId).first<Record<string, unknown>>();
}

async function failedLeaseMutation(env: Env, projectId: number, runId: string) {
  const current = await automationRun(env, projectId, runId);
  if (!current) throw failure('automation_run_not_found', 'Automation run not found', 404, false);
  throw failure('automation_run_claim_lost', 'Automation run lease ownership was lost', 409, false);
}

export function matchesAutomation(config: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  const equals = parseObject(config.equals);
  for (const [key, expected] of Object.entries(equals)) {
    if (!safeConditionKey(key) || payload[key] !== expected) return false;
  }
  const minimum = parseObject(config.minimum);
  for (const [key, expected] of Object.entries(minimum)) {
    if (!safeConditionKey(key) || !numericComparison(payload[key], expected, (actual, limit) => actual >= limit)) return false;
  }
  const maximum = parseObject(config.maximum);
  for (const [key, expected] of Object.entries(maximum)) {
    if (!safeConditionKey(key) || !numericComparison(payload[key], expected, (actual, limit) => actual <= limit)) return false;
  }
  return true;
}

function safeConditionKey(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

function numericComparison(actual: unknown, expected: unknown, compare: (actual: number, expected: number) => boolean) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && compare(actualNumber, expectedNumber);
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameEventIdentity(
  stored: Record<string, unknown>,
  eventType: string,
  subjectId: string | null,
  payload: Record<string, unknown>,
) {
  return String(stored.event_type || '') === eventType
    && (stored.subject_id == null ? null : String(stored.subject_id)) === subjectId
    && canonicalJson(parseObject(stored.payload_json)) === canonicalJson(payload);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function validDate(value: unknown): string {
  const parsed = new Date(requiredString(value, 'occurred_at', 64));
  if (!Number.isFinite(parsed.getTime())) throw failure('occurred_at_invalid', 'occurred_at must be an ISO date');
  return parsed.toISOString();
}
