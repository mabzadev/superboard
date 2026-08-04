import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, AUTOMATION_TRIGGER_ACTIONS, type Device, type Platform } from './types';

export function positiveInt(value: unknown, field = 'project_id'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw failure(`${field}_invalid`, `${field} must be a positive integer`);
  return parsed;
}

export function requiredString(value: unknown, field: string, max = 255): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed || parsed.length > max) throw failure(`${field}_invalid`, `${field} is required and must contain at most ${max} characters`);
  return parsed;
}

export function optionalString(value: unknown, field: string, max = 255): string | null {
  if (value == null || value === '') return null;
  return requiredString(value, field, max);
}

export function platform(value: unknown): Platform {
  if (value !== 'apple' && value !== 'google') throw failure('platform_invalid', 'platform must be apple or google');
  return value;
}

export function device(value: unknown, selectedPlatform: Platform): Device {
  const parsed = value || (selectedPlatform === 'apple' ? 'iphone' : 'android');
  if (!['iphone', 'ipad', 'android'].includes(String(parsed))) throw failure('device_invalid', 'device must be iphone, ipad or android');
  if (selectedPlatform === 'google' && parsed !== 'android') throw failure('device_invalid', 'Google apps must use the android device');
  if (selectedPlatform === 'apple' && parsed === 'android') throw failure('device_invalid', 'Apple apps must use an Apple device');
  return parsed as Device;
}

export function locale(value: unknown, field: string, fallback: string): string {
  const parsed = String(value || fallback).trim().toLowerCase();
  if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(parsed)) throw failure(`${field}_invalid`, `${field} must be a valid store locale`);
  return parsed;
}

export function booleanFlag(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw failure('boolean_invalid', 'Boolean fields must be true or false');
  return value;
}

export function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw failure(`${field}_invalid`, `${field} must be a JSON object`);
  const encoded = JSON.stringify(value);
  if (encoded.length > 32_768) throw failure(`${field}_too_large`, `${field} is limited to 32 KB`, 413);
  return value as Record<string, unknown>;
}

export function automationConfig(value: unknown, field: string): Record<string, unknown> {
  const config = jsonObject(value, field);
  assertSafeAutomationValue(config, field, 0, new WeakSet<object>());
  return config;
}

export function automationTrigger(value: unknown): string {
  const parsed = requiredString(value, 'trigger_type', 64);
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(parsed)) {
    throw failure('trigger_type_invalid', 'Unsupported automation trigger');
  }
  return parsed;
}

export function automationAction(value: unknown): string {
  const parsed = requiredString(value, 'action_type', 32);
  if (!(AUTOMATION_ACTIONS as readonly string[]).includes(parsed)) {
    throw failure('action_type_invalid', 'Unsupported automation action');
  }
  return parsed;
}

export function assertAutomationCompatibility(trigger: string, action: string) {
  const supported = AUTOMATION_TRIGGER_ACTIONS[trigger as keyof typeof AUTOMATION_TRIGGER_ACTIONS] || [];
  if (!supported.includes(action as never)) {
    throw failure('automation_action_incompatible', 'The selected action is not supported for this trigger');
  }
}

export function failure(code: string, message: string, status = 422, retryable = false, retryDelaySeconds?: number) {
  return Object.assign(new Error(message), { code, status, retryable, retryDelaySeconds });
}

export async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const announced = Number(request.headers.get('content-length') || 0);
  if (announced > 65_536) throw failure('request_too_large', 'Request body is limited to 64 KB', 413);
  const text = await request.text();
  if (text.length > 65_536) throw failure('request_too_large', 'Request body is limited to 64 KB', 413);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return jsonObject(parsed, 'body');
  } catch (error) {
    if ((error as { code?: string }).code) throw error;
    throw failure('json_invalid', 'Request body must contain valid JSON', 400);
  }
}

function assertSafeAutomationValue(value: unknown, field: string, depth: number, seen: WeakSet<object>) {
  if (depth > 8) throw failure(`${field}_invalid`, 'Automation configuration nesting is limited to 8 levels');
  if (!value || typeof value !== 'object') return;
  if (seen.has(value as object)) throw failure(`${field}_invalid`, 'Automation configuration must be valid JSON');
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) assertSafeAutomationValue(item, field, depth + 1, seen);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
    if (['__proto__', 'prototype', 'constructor'].includes(key.toLocaleLowerCase('en'))
      || normalized.includes('entitlement')
      || normalized === 'premium'
      || normalized === 'billingstatus'
      || normalized === 'subscriptionstatus') {
      throw failure(`${field}_invalid`, 'Automation configuration cannot contain entitlement mutation fields');
    }
    assertSafeAutomationValue(nested, field, depth + 1, seen);
  }
}
