import type { Env } from './types';
import { AUTOMATION_TRIGGERS } from './types';
import { failure, jsonObject, requiredString } from './validation';
import { audit } from './sync';

type AutomationRow = {
  id: string;
  project_id: number;
  trigger_type: string;
  action_type: 'chat' | 'push' | 'in_app';
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
    SELECT id, event_type, subject_id, occurred_at, payload_json FROM growth_events
    WHERE project_id = ? AND provider_event_id = ?
  `).bind(projectId, providerEventId).first<Record<string, unknown>>();
  if (!event) throw failure('event_persistence_failed', 'Unable to persist the growth event', 503, true);
  if (inserted.meta.changes > 0) {
    const automations = await env.DB.prepare(`
      SELECT * FROM growth_automations WHERE project_id = ? AND enabled = 1 AND trigger_type = ? ORDER BY id
    `).bind(projectId, eventType).all<AutomationRow>();
    for (const automation of automations.results) {
      const triggerConfig = parseObject(automation.trigger_config_json);
      if (!matchesAutomation(triggerConfig, payload)) continue;
      const actionConfig = parseObject(automation.action_config_json);
      const actionPayload = {
        channel: automation.action_type,
        subject_id: subjectId,
        message: actionConfig,
        event: { id: event.id, type: eventType, occurred_at: occurredAt },
      };
      await env.DB.prepare(`
        INSERT INTO growth_automation_runs (
          id, project_id, automation_id, event_id, action_payload_json
        ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(automation_id, event_id) DO NOTHING
      `).bind(crypto.randomUUID(), projectId, automation.id, event.id, JSON.stringify(actionPayload)).run();
    }
    await audit(env, projectId, 'growth.event.accepted', 'event', String(event.id), {
      provider_event_id: providerEventId, event_type: eventType,
    });
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
  const lastError = input.last_error == null ? null : requiredString(input.last_error, 'last_error', 2000);
  const run = await env.DB.prepare(`
    UPDATE growth_automation_runs SET status = ?, last_error = ?, updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND status = 'pending' RETURNING id, status
  `).bind(status, lastError, runId, projectId).first<Record<string, unknown>>();
  if (!run) throw failure('automation_run_not_found', 'Pending automation run not found', 404);
  await audit(env, projectId, `growth.automation_run.${status}`, 'automation_run', runId, { last_error: lastError });
  return run;
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

function validDate(value: unknown): string {
  const parsed = new Date(requiredString(value, 'occurred_at', 64));
  if (!Number.isFinite(parsed.getTime())) throw failure('occurred_at_invalid', 'occurred_at must be an ISO date');
  return parsed.toISOString();
}
