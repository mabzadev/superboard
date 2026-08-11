import { describe, expect, it } from 'vitest';
import { readJsonObjectLimited, readTextLimited } from './http-limits';

describe('bounded HTTP body readers', () => {
  it('reads a bounded JSON object', async () => {
    await expect(readJsonObjectLimited(
      Response.json({ status: 'ok' }),
      128,
    )).resolves.toEqual({ status: 'ok' });
  });

  it('rejects a chunked body after the byte limit even without content-length', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('1234'));
        controller.enqueue(new TextEncoder().encode('5678'));
        controller.close();
      },
    }));
    await expect(readTextLimited(response, 7)).rejects.toMatchObject({
      code: 'body_too_large',
      status: 413,
    });
  });

  it('does not treat arrays or primitives as provider response objects', async () => {
    await expect(readJsonObjectLimited(new Response('[1,2,3]'), 128))
      .resolves.toEqual({});
    await expect(readJsonObjectLimited(new Response('null'), 128))
      .resolves.toEqual({});
  });
});
