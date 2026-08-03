import { describe, expect, it } from 'vitest';
import { parseAllowedProjectIds, requireProject, timingSafeEqual } from './auth';
import type { Env } from './types';
import { parseMessageInput, safeFilename } from './validation';

describe('Messaging validation', () => {
  it('accepts a bounded idempotent message', () => {
    expect(parseMessageInput({ body: ' Hello ', client_message_id: 'local-1' })).toEqual({
      body: 'Hello', attachment_key: null, attachment_name: null,
      attachment_content_type: null, client_message_id: 'local-1',
    });
  });

  it('rejects empty and oversized messages', () => {
    expect(() => parseMessageInput({ client_message_id: 'x' })).toThrow(/required/);
    expect(() => parseMessageInput({ body: 'x'.repeat(8001), client_message_id: 'x' })).toThrow(/limited/);
  });

  it('normalizes attachment filenames', () => {
    expect(safeFilename('../../voice note.m4a')).toBe('.._.._voice_note.m4a');
  });

  it('compares internal capabilities without early string equality', () => {
    expect(timingSafeEqual('same', 'same')).toBe(true);
    expect(timingSafeEqual('same', 'different')).toBe(false);
  });

  it('loads the Messaging project allowlist from validated deployment configuration', () => {
    expect(parseAllowedProjectIds('11, 12,11')).toEqual([11, 12]);
    expect(requireProject({ ALLOWED_PROJECT_IDS: '11,12' } as Env, '12')).toBe(12);
    expect(() => requireProject({ ALLOWED_PROJECT_IDS: '11,12' } as Env, '13'))
      .toThrow(/not enabled/);
  });

  it('fails closed when Messaging project configuration is malformed', () => {
    expect(() => parseAllowedProjectIds('11,project-two')).toThrowError(expect.objectContaining({
      code: 'messaging_configuration_invalid',
      status: 503,
    }));
  });
});
