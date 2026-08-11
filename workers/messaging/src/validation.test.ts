import { describe, expect, it } from 'vitest';
import {
  parseAllowedProjectIds,
  requireProject,
  timingSafeEqual,
  validateApplicationIdentityClaims,
} from './auth';
import type { Env } from './types';
import { parseMessageInput, readBytesLimited, readJsonObject, safeFilename } from './validation';

describe('Messaging validation', () => {
  it('accepts a bounded idempotent message', () => {
    expect(parseMessageInput({ body: ' Hello ', client_message_id: 'local-1' })).toEqual({
      body: 'Hello', attachment_key: null, attachment_name: null,
      attachment_content_type: null, client_message_id: 'local-1',
      visibility: 'public', content_type: 'text', reply_to_message_id: null, metadata: {},
    });
  });

  it('rejects empty and oversized messages', () => {
    expect(() => parseMessageInput({ client_message_id: 'x' })).toThrow(/required/);
    expect(() => parseMessageInput({ body: 'x'.repeat(8001), client_message_id: 'x' })).toThrow(/limited/);
  });

  it('normalizes attachment filenames', () => {
    expect(safeFilename('../../voice note.m4a')).toBe('.._.._voice_note.m4a');
    expect(parseMessageInput({
      attachment_key: 'attachments/11/user/conversation/id/voice_note.m4a',
      client_message_id: 'attachment-1',
    }).attachment_key).toBe('attachments/11/user/conversation/id/voice_note.m4a');
    expect(() => parseMessageInput({
      attachment_key: 'attachments/11/../private/file.txt', client_message_id: 'attachment-2',
    })).toThrow(/invalid/);
  });

  it('stops reading chunked JSON and attachment bodies at their byte limits', async () => {
    await expect(readJsonObject(new Request('https://messages.test', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"body":"'));
          controller.enqueue(new Uint8Array(16_384));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit))).rejects.toMatchObject({ code: 'request_too_large', status: 413 });

    await expect(readBytesLimited(new Request('https://messages.test', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8));
          controller.enqueue(new Uint8Array(8));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit), 10)).rejects.toMatchObject({ code: 'attachment_too_large', status: 413 });
  });

  it('compares internal capabilities without early string equality', async () => {
    await expect(timingSafeEqual('same', 'same')).resolves.toBe(true);
    await expect(timingSafeEqual('same', 'different')).resolves.toBe(false);
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

  it('accepts only the short-lived identity contract issued by the auth gateway', () => {
    expect(validateApplicationIdentityClaims({
      sub: 'user-1', iat: 1_000, exp: 1_300, jti: 'token-1',
    })).toEqual({ subject: 'user-1', expiresAt: 1_300_000 });
    expect(() => validateApplicationIdentityClaims({
      sub: 'user-1', iat: 1_000, exp: 2_000, jti: 'token-2',
    })).toThrow(/lifetime/);
    expect(() => validateApplicationIdentityClaims({
      sub: 'user-1', iat: 1_000, exp: 1_300,
    })).toThrow(/token id/);
  });
});
