import { describe, expect, it } from 'vitest';
import { readTextLimited } from './http-limits';

describe('readTextLimited', () => {
  it('reads a bounded response body', async () => {
    await expect(readTextLimited(new Response('billing-ok'), 64)).resolves.toBe('billing-ok');
  });

  it('rejects streamed bodies after crossing the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('1234'));
        controller.enqueue(new TextEncoder().encode('5678'));
        controller.close();
      },
    });
    await expect(readTextLimited(new Response(stream), 6)).rejects.toThrow(/too large/);
  });

  it('rejects an announced oversized body without reading it', async () => {
    const response = new Response('x', { headers: { 'Content-Length': '100' } });
    await expect(readTextLimited(response, 10)).rejects.toMatchObject({ status: 413 });
  });
});
