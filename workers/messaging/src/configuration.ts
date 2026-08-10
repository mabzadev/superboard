import { Hono } from 'hono';
import type { Env } from './types';
import { readJsonObject } from './validation';
import { validateWorkflowConfiguration } from './workflows';
import { isSafePublicHttpsUrl } from '@opengrow/contracts/url-security';

type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'string_list' | 'json';

type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  max_length?: number;
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
};

type EntityDefinition = {
  label: string;
  description: string;
  fields: FieldDefinition[];
};

export const configurationCatalog = {
  inbox: definition('Inbox', 'Channel behavior, widget presentation, pre-chat collection, availability, and conversation continuity.', [
    select('channel_type', 'Channel', ['mobile', 'web', 'api', 'email', 'whatsapp', 'facebook', 'instagram', 'sms', 'telegram', 'line', 'tiktok'], true),
    text('identifier', 'Identifier', true, 128), text('timezone', 'Timezone', false, 64),
    bool('greeting_enabled', 'Greeting enabled'), text('welcome_title', 'Welcome title', false, 120),
    textarea('welcome_message', 'Welcome message', 2000), bool('pre_chat_form_enabled', 'Pre-chat form enabled'),
    json('pre_chat_fields', 'Pre-chat fields'), select('email_collection', 'Email collection', ['off', 'optional', 'required']),
    bool('conversation_continuity', 'Conversation continuity'), bool('csat_enabled', 'CSAT enabled'),
    bool('auto_assignment', 'Automatic assignment'), bool('allow_reopen', 'Allow customer reopening'),
    select('reply_time_expectation', 'Reply time expectation', ['minutes', 'hours', 'day', 'custom']),
    text('reply_time_message', 'Reply time message', false, 255), bool('working_hours_enabled', 'Working hours enabled'),
    textarea('out_of_office_message', 'Out-of-office message', 2000),
    text('provider_secret_reference', 'Provider secret reference', false, 255, 'Reference a bound secret; never store provider credentials here.'),
  ]),
  agent: definition('Agent', 'An operator backed by an identity from the existing authentication gateway.', [
    text('auth_user_id', 'Authentication user ID', true, 255), text('display_name', 'Display name', true, 120),
    select('role', 'Role', ['administrator', 'supervisor', 'agent'], true),
    select('availability', 'Availability', ['online', 'busy', 'offline'], true),
    number('capacity', 'Conversation capacity', 0, 10000), bool('auto_offline', 'Set offline when inactive'),
  ]),
  team: definition('Team', 'Agent grouping used for assignment and reporting.', [
    textarea('description', 'Description', 1000), bool('allow_auto_assign', 'Allow automatic assignment'),
    list('member_user_ids', 'Member user IDs'),
  ]),
  label: definition('Label', 'Reusable conversation classification.', [
    text('color', 'Color', true, 32), textarea('description', 'Description', 500), bool('show_on_sidebar', 'Show in Inbox navigation'),
  ]),
  canned_response: definition('Canned response', 'A saved response available in the composer.', [
    text('short_code', 'Short code', true, 64), textarea('content', 'Response content', 8000, true),
  ]),
  macro: definition('Macro', 'A reusable ordered set of conversation actions.', [
    json('actions', 'Actions', true), select('visibility', 'Visibility', ['personal', 'team', 'project']),
  ]),
  custom_attribute: definition('Custom attribute', 'Typed metadata for contacts or conversations.', [
    text('key', 'Key', true, 64), select('model', 'Model', ['contact', 'conversation'], true),
    select('value_type', 'Value type', ['text', 'number', 'date', 'boolean', 'list', 'link'], true),
    textarea('description', 'Description', 500), list('allowed_values', 'Allowed values'),
  ]),
  automation_rule: definition('Automation rule', 'Conditions and actions executed for a Messaging event. Entitlements are never valid actions.', [
    select('event_name', 'Event', ['conversation_created', 'conversation_updated', 'message_created', 'conversation_opened', 'conversation_resolved'], true),
    json('conditions', 'Conditions', true), json('actions', 'Actions', true),
  ]),
  assignment_policy: definition('Assignment policy', 'Controls deterministic routing to agents or teams.', [
    select('policy_type', 'Policy', ['round_robin', 'balanced', 'manual'], true),
    select('queue_order', 'Queue order', ['oldest', 'priority', 'recent'], true),
    number('max_assignments_per_agent', 'Maximum assignments per agent', 0, 10000),
    list('inbox_ids', 'Inbox IDs'), list('team_ids', 'Team IDs'),
  ]),
  sla_policy: definition('SLA policy', 'Response and resolution targets.', [
    number('first_response_minutes', 'First response target (minutes)', 1, 525600, true),
    number('next_response_minutes', 'Next response target (minutes)', 1, 525600),
    number('resolution_minutes', 'Resolution target (minutes)', 1, 525600, true),
    bool('business_hours_only', 'Count business hours only'),
  ]),
  webhook: definition('Webhook', 'Signed outbound Messaging events.', [
    text('url', 'Endpoint URL', true, 2048),
    list('events', 'Events', true), text('secret_reference', 'Signing secret reference', true, 255, 'Reference a bound secret; never store the secret value.'),
  ]),
  working_hours: definition('Working hours', 'Timezone-aware availability and holidays.', [
    text('timezone', 'Timezone', true, 64), json('weekly_schedule', 'Weekly schedule', true),
    json('closed_dates', 'Closed dates'), textarea('unavailable_message', 'Unavailable message', 2000),
  ]),
  notification_preference: definition('Notification preference', 'Per-agent delivery and sound preferences.', [
    text('auth_user_id', 'Authentication user ID', true, 255), bool('email_enabled', 'Email notifications'),
    bool('push_enabled', 'Push notifications'), bool('browser_enabled', 'Browser notifications'),
    bool('in_app_enabled', 'In-app notifications'), bool('audio_enabled', 'Notification sounds'),
    list('muted_event_types', 'Muted event types'),
  ]),
  saved_filter: definition('Saved filter', 'A reusable Inbox or contact search.', [
    select('model', 'Model', ['conversation', 'contact'], true), json('query', 'Filter query', true),
  ]),
  campaign: definition('Campaign', 'A support campaign delivered through a configured Inbox.', [
    select('campaign_type', 'Type', ['one_off', 'ongoing'], true), text('inbox_id', 'Inbox ID', true, 255),
    textarea('message', 'Message', 8000, true), json('audience', 'Audience', true), text('scheduled_at', 'Scheduled time', false, 64),
  ]),
  integration: definition('Integration', 'Optional external integration configuration without embedded credentials.', [
    select('provider', 'Provider', ['slack', 'linear', 'notion', 'shopify', 'dyte', 'custom'], true),
    text('secret_reference', 'Secret reference', true, 255), json('settings', 'Provider settings'),
  ]),
  agent_bot: definition('Agent bot', 'A bot that can receive assigned conversations.', [
    textarea('description', 'Description', 1000), text('outgoing_url', 'Outgoing webhook URL', true, 2048),
    text('secret_reference', 'Signing secret reference', true, 255),
  ]),
  capacity_policy: definition('Capacity policy', 'Maximum concurrent work per priority.', [
    number('default_capacity', 'Default capacity', 0, 10000, true), json('priority_limits', 'Priority limits'),
  ]),
  leave_schedule: definition('Leave schedule', 'Temporary agent unavailability.', [
    text('auth_user_id', 'Authentication user ID', true, 255), text('starts_at', 'Starts at', true, 64),
    text('ends_at', 'Ends at', true, 64), textarea('reason', 'Reason', 500),
  ]),
  dashboard_app: definition('Dashboard app', 'A contextual tool displayed beside a conversation.', [
    text('url', 'Application URL', true, 2048), list('placements', 'Placements', true),
  ]),
  email_template: definition('Email template', 'A localized transactional email template.', [
    text('template_type', 'Template type', true, 64), text('locale', 'Locale', true, 16),
    text('subject', 'Subject', true, 255), textarea('body', 'Body', 20000, true),
  ]),
} as const satisfies Record<string, EntityDefinition>;

export type ConfigurationEntityType = keyof typeof configurationCatalog;

const configuration = new Hono<{ Bindings: Env }>();

configuration.get('/:projectId/settings', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const settings = await getProjectSettings(c.env.DB, projectId);
  const entities = await c.env.DB.prepare(`
    SELECT * FROM messaging_configuration_entities WHERE project_id = ?
    ORDER BY entity_type, position, name
  `).bind(projectId).all<Record<string, unknown>>();
  return c.json({
    data: {
      settings,
      entities: entities.results.map(serializeEntity),
      catalog: configurationCatalog,
    },
  });
});

configuration.patch('/:projectId/settings', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requiredActor(c.req.header('X-OpenGrow-Agent-Id'));
  const body = validateProjectSettings(await readJsonObject(c.req.raw));
  const before = await getProjectSettings(c.env.DB, projectId);
  await c.env.DB.prepare(`
    INSERT INTO messaging_project_settings (
      project_id, business_name, locale, timezone, date_format, auto_resolve_minutes,
      attachment_max_bytes, allowed_content_types_json, features_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      business_name = excluded.business_name, locale = excluded.locale,
      timezone = excluded.timezone, date_format = excluded.date_format,
      auto_resolve_minutes = excluded.auto_resolve_minutes,
      attachment_max_bytes = excluded.attachment_max_bytes,
      allowed_content_types_json = excluded.allowed_content_types_json,
      features_json = excluded.features_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(
    projectId, body.business_name, body.locale, body.timezone, body.date_format,
    body.auto_resolve_minutes, body.attachment_max_bytes,
    JSON.stringify(body.allowed_content_types), JSON.stringify(body.features),
  ).run();
  const after = await getProjectSettings(c.env.DB, projectId);
  await configurationAudit(c.env.DB, projectId, null, 'project_settings', 'updated', actorId, before, after);
  return c.json({ data: after });
});

configuration.get('/:projectId/settings/entities', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const entityType = optionalEntityType(c.req.query('type'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messaging_configuration_entities
    WHERE project_id = ? AND (? IS NULL OR entity_type = ?)
    ORDER BY entity_type, position, name
  `).bind(projectId, entityType, entityType).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeEntity) });
});

configuration.post('/:projectId/settings/entities', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requiredActor(c.req.header('X-OpenGrow-Agent-Id'));
  const entity = validateEntity(await readJsonObject(c.req.raw));
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`
      INSERT INTO messaging_configuration_entities (
        id, project_id, entity_type, name, enabled, position, configuration_json, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, projectId, entity.entity_type, entity.name, entity.enabled ? 1 : 0,
      entity.position, JSON.stringify(entity.configuration), actorId, actorId).run();
  } catch (error) {
    if (String((error as Error).message).includes('UNIQUE')) {
      throw failure('configuration_name_conflict', 'A configuration with this name already exists', 409);
    }
    throw error;
  }
  const created = await entityById(c.env.DB, projectId, id);
  await configurationAudit(c.env.DB, projectId, id, entity.entity_type, 'created', actorId, null, created);
  return c.json({ data: created }, 201);
});

configuration.patch('/:projectId/settings/entities/:entityId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requiredActor(c.req.header('X-OpenGrow-Agent-Id'));
  const before = await entityById(c.env.DB, projectId, c.req.param('entityId'));
  const entity = validateEntity(await readJsonObject(c.req.raw), String(before.entity_type));
  try {
    await c.env.DB.prepare(`
      UPDATE messaging_configuration_entities SET
        name = ?, enabled = ?, position = ?, configuration_json = ?, updated_by = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?
    `).bind(entity.name, entity.enabled ? 1 : 0, entity.position,
      JSON.stringify(entity.configuration), actorId, projectId, c.req.param('entityId')).run();
  } catch (error) {
    if (String((error as Error).message).includes('UNIQUE')) {
      throw failure('configuration_name_conflict', 'A configuration with this name already exists', 409);
    }
    throw error;
  }
  const after = await entityById(c.env.DB, projectId, c.req.param('entityId'));
  await configurationAudit(c.env.DB, projectId, String(after.id), String(after.entity_type), 'updated', actorId, before, after);
  return c.json({ data: after });
});

configuration.delete('/:projectId/settings/entities/:entityId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requiredActor(c.req.header('X-OpenGrow-Agent-Id'));
  const before = await entityById(c.env.DB, projectId, c.req.param('entityId'));
  await c.env.DB.prepare('DELETE FROM messaging_configuration_entities WHERE project_id = ? AND id = ?')
    .bind(projectId, c.req.param('entityId')).run();
  await configurationAudit(c.env.DB, projectId, String(before.id), String(before.entity_type), 'deleted', actorId, before, null);
  return c.body(null, 204);
});

configuration.get('/:projectId/settings/audit', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 250);
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messaging_configuration_audit_events
    WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(projectId, limit).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({
    ...row,
    before: parseJson(row.before_json, null),
    after: parseJson(row.after_json, null),
  })) });
});

export async function getPublicMessagingConfiguration(db: D1Database, projectId: number) {
  const settings = await getProjectSettings(db, projectId);
  const inboxes = await db.prepare(`
    SELECT id, name, enabled, configuration_json FROM messaging_configuration_entities
    WHERE project_id = ? AND entity_type = 'inbox' AND enabled = 1
    ORDER BY position, name
  `).bind(projectId).all<Record<string, unknown>>();
  return {
    locale: settings.locale,
    timezone: settings.timezone,
    attachment_max_bytes: settings.attachment_max_bytes,
    allowed_content_types: settings.allowed_content_types,
    features: settings.features,
    inboxes: inboxes.results.map((row) => {
      const value = parseJson(row.configuration_json, {}) as Record<string, unknown>;
      return {
        id: row.id,
        name: row.name,
        channel_type: value.channel_type,
        greeting_enabled: value.greeting_enabled,
        welcome_title: value.welcome_title,
        welcome_message: value.welcome_message,
        pre_chat_form_enabled: value.pre_chat_form_enabled,
        pre_chat_fields: value.pre_chat_fields,
        email_collection: value.email_collection,
        conversation_continuity: value.conversation_continuity,
        csat_enabled: value.csat_enabled,
        reply_time_expectation: value.reply_time_expectation,
        reply_time_message: value.reply_time_message,
        working_hours_enabled: value.working_hours_enabled,
        out_of_office_message: value.out_of_office_message,
      };
    }),
  };
}

export function validateEntity(input: Record<string, unknown>, fixedType?: string) {
  const entityType = requiredEntityType(fixedType || input.entity_type);
  if (fixedType && input.entity_type != null && input.entity_type !== fixedType) {
    throw failure('configuration_type_immutable', 'Configuration type cannot be changed');
  }
  const name = requiredText(input.name, 'name', 120);
  const position = input.position == null ? 0 : integer(input.position, 'position', -100000, 100000);
  const enabled = input.enabled == null ? true : boolean(input.enabled, 'enabled');
  const rawConfiguration = object(input.configuration, 'configuration');
  const fields = configurationCatalog[entityType].fields;
  const allowed = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(rawConfiguration)) {
    if (!allowed.has(key)) throw failure('configuration_field_unknown', `Unknown configuration field: ${key}`);
    if (looksLikeSecret(key) && !key.endsWith('_reference')) {
      throw failure('configuration_secret_forbidden', 'Secret values must use a bound secret reference');
    }
  }
  const normalized: Record<string, unknown> = {};
  for (const field of fields) {
    const value = rawConfiguration[field.key];
    if (value == null || value === '') {
      if (field.required) throw failure('configuration_field_required', `${field.label} is required`);
      continue;
    }
    normalized[field.key] = validateField(field, value);
  }
  if ('url' in normalized && !isSafePublicHttpsUrl(normalized.url)) {
    throw failure('configuration_url_invalid', 'Endpoint URL must use public HTTPS without embedded credentials');
  }
  if ('outgoing_url' in normalized && !isSafePublicHttpsUrl(normalized.outgoing_url)) {
    throw failure('configuration_url_invalid', 'Outgoing webhook URL must use public HTTPS without embedded credentials');
  }
  if (entityType === 'webhook' && !/^[A-Z][A-Z0-9_]{0,127}$/.test(String(normalized.secret_reference || ''))) {
    throw failure('configuration_secret_reference_invalid', 'Signing secret reference must be an uppercase Worker binding name');
  }
  validateWorkflowConfiguration(entityType, normalized);
  return { entity_type: entityType, name, enabled, position, configuration: normalized };
}

export function validateProjectSettings(input: Record<string, unknown>) {
  const features = object(input.features ?? {}, 'features');
  for (const [key, value] of Object.entries(features)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof value !== 'boolean') {
      throw failure('features_invalid', 'Feature flags must be boolean values with stable lowercase keys');
    }
  }
  return {
    business_name: optionalText(input.business_name, 'business_name', 120),
    locale: optionalText(input.locale, 'locale', 16) || 'en',
    timezone: optionalText(input.timezone, 'timezone', 64) || 'UTC',
    date_format: optionalText(input.date_format, 'date_format', 32) || 'YYYY-MM-DD',
    auto_resolve_minutes: input.auto_resolve_minutes == null ? null : integer(input.auto_resolve_minutes, 'auto_resolve_minutes', 0, 525600),
    attachment_max_bytes: input.attachment_max_bytes == null ? 10 * 1024 * 1024 : integer(input.attachment_max_bytes, 'attachment_max_bytes', 1, 10 * 1024 * 1024),
    allowed_content_types: input.allowed_content_types == null ? [] : stringList(input.allowed_content_types, 'allowed_content_types', 100, 255),
    features,
  };
}

async function getProjectSettings(db: D1Database, projectId: number) {
  const row = await db.prepare('SELECT * FROM messaging_project_settings WHERE project_id = ?')
    .bind(projectId).first<Record<string, unknown>>();
  if (!row) return validateProjectSettings({});
  return {
    project_id: projectId,
    business_name: row.business_name,
    locale: row.locale,
    timezone: row.timezone,
    date_format: row.date_format,
    auto_resolve_minutes: row.auto_resolve_minutes,
    attachment_max_bytes: row.attachment_max_bytes,
    allowed_content_types: parseJson(row.allowed_content_types_json, []),
    features: parseJson(row.features_json, {}),
    updated_at: row.updated_at,
  };
}

async function entityById(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`
    SELECT * FROM messaging_configuration_entities WHERE project_id = ? AND id = ?
  `).bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('configuration_not_found', 'Configuration not found', 404);
  return serializeEntity(row);
}

function serializeEntity(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    enabled: Number(row.enabled) === 1,
    configuration: parseJson(row.configuration_json, {}),
    configuration_json: undefined,
  };
}

async function configurationAudit(
  db: D1Database,
  projectId: number,
  entityId: string | null,
  entityType: string,
  action: 'created' | 'updated' | 'deleted',
  actorId: string,
  before: unknown,
  after: unknown,
) {
  await db.prepare(`
    INSERT INTO messaging_configuration_audit_events (
      id, project_id, entity_id, entity_type, action, actor_id, before_json, after_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), projectId, entityId, entityType, action, actorId,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)).run();
}

function validateField(field: FieldDefinition, value: unknown): unknown {
  if (field.type === 'boolean') return boolean(value, field.key);
  if (field.type === 'number') return integer(value, field.key, field.min ?? Number.MIN_SAFE_INTEGER, field.max ?? Number.MAX_SAFE_INTEGER);
  if (field.type === 'string_list') return stringList(value, field.key, 100, 255);
  if (field.type === 'json') return jsonValue(value, field.key);
  const parsed = requiredText(value, field.key, field.max_length || 2048);
  if (field.type === 'select' && !field.options?.includes(parsed)) {
    throw failure('configuration_value_invalid', `Invalid value for ${field.label}`);
  }
  return parsed;
}

function definition(label: string, description: string, fields: FieldDefinition[]): EntityDefinition {
  return { label, description, fields };
}
function text(key: string, label: string, required = false, max_length = 255, help?: string): FieldDefinition {
  return { key, label, type: 'text', required, max_length, help };
}
function textarea(key: string, label: string, max_length: number, required = false): FieldDefinition {
  return { key, label, type: 'textarea', required, max_length };
}
function bool(key: string, label: string): FieldDefinition { return { key, label, type: 'boolean' }; }
function number(key: string, label: string, min: number, max: number, required = false): FieldDefinition {
  return { key, label, type: 'number', min, max, required };
}
function select(key: string, label: string, options: string[], required = false): FieldDefinition {
  return { key, label, type: 'select', options, required };
}
function list(key: string, label: string, required = false): FieldDefinition { return { key, label, type: 'string_list', required }; }
function json(key: string, label: string, required = false): FieldDefinition { return { key, label, type: 'json', required }; }

function positiveInt(value: unknown) {
  return integer(value, 'project_id', 1, Number.MAX_SAFE_INTEGER);
}
function integer(value: unknown, field: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw failure(`${field}_invalid`, `${field} must be an integer between ${min} and ${max}`);
  return parsed;
}
function boolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw failure(`${field}_invalid`, `${field} must be a boolean`);
  return value;
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(`${field}_invalid`, `${field} must be an object`);
  return value as Record<string, unknown>;
}
function jsonValue(value: unknown, field: string) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized == null || serialized.length > 16_000) throw new Error('invalid');
    return JSON.parse(serialized) as unknown;
  } catch {
    throw failure(`${field}_invalid`, `${field} must be valid JSON under 16 KB`);
  }
}
function requiredText(value: unknown, field: string, max: number) {
  const parsed = String(value || '').trim();
  if (!parsed || parsed.length > max) throw failure(`${field}_invalid`, `${field} is required and must be at most ${max} characters`);
  return parsed;
}
function optionalText(value: unknown, field: string, max: number) {
  if (value == null) return '';
  const parsed = String(value).trim();
  if (parsed.length > max) throw failure(`${field}_invalid`, `${field} must be at most ${max} characters`);
  return parsed;
}
function stringList(value: unknown, field: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) throw failure(`${field}_invalid`, `${field} must be an array with at most ${maxItems} items`);
  const values = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (values.some((item) => item.length > maxLength)) throw failure(`${field}_invalid`, `${field} contains an item that is too long`);
  return values;
}
function requiredActor(value: unknown) {
  return requiredText(value, 'agent_id', 255);
}
function requiredEntityType(value: unknown): ConfigurationEntityType {
  const parsed = String(value || '') as ConfigurationEntityType;
  if (!(parsed in configurationCatalog)) throw failure('configuration_type_invalid', 'Configuration type is invalid');
  return parsed;
}
function optionalEntityType(value: unknown): ConfigurationEntityType | null {
  if (value == null || value === '') return null;
  return requiredEntityType(value);
}
function looksLikeSecret(key: string) {
  return /(^|_)(secret|password|token|api_key|access_key|private_key)($|_)/.test(key);
}
function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}
function failure(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

export default configuration;
