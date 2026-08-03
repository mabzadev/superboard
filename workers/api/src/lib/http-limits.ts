export async function readTextLimited(
  source: Request | Response,
  maxBytes: number,
  tooLargeMessage = 'Body is too large',
): Promise<string> {
  const announced = Number(source.headers.get('Content-Length') || 0);
  if (announced > maxBytes) throw Object.assign(new Error(tooLargeMessage), { status: 413, code: 'body_too_large' });
  if (!source.body) return '';
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(tooLargeMessage);
        throw Object.assign(new Error(tooLargeMessage), { status: 413, code: 'body_too_large' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
