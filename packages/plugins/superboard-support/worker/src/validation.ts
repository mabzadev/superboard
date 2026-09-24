import {
  SUPPORT_LIMITS,
  SUPPORT_MESSAGE_CONTENT_TYPES,
  type SupportMessageContentType,
} from '@superboard/contracts/support';
import { publicError } from './auth';

export const MAX_MESSAGE_LENGTH = SUPPORT_LIMITS.messageBodyBytesMaximum;
export const MAX_ATTACHMENT_BYTES = SUPPORT_LIMITS.attachmentBytesMaximum;
export const MAX_JSON_BYTES = 16 * 1024;

export type MessageInput = {
  attachments: Array<{
    key: string;
    name: string | null;
    content_type: string | null;
  }>;
  body: string | null;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_content_type: string | null;
  client_message_id: string;
  visibility: 'public' | 'private';
  content_type: SupportMessageContentType;
  reply_to_message_id: string | null;
  metadata: Record<string, unknown>;
};

export function parseMessageInput(value: unknown): MessageInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const attachmentKey = typeof body.attachment_key === 'string' ? body.attachment_key.trim() : '';
  const attachments = parseAttachments(body, attachmentKey);
  const clientMessageId = typeof body.client_message_id === 'string' ? body.client_message_id.trim() : '';
  if ((!text && attachments.length === 0) || new TextEncoder().encode(text).byteLength > MAX_MESSAGE_LENGTH) {
    throw publicError('message_invalid', `A message or attachment is required; text is limited to ${MAX_MESSAGE_LENGTH} UTF-8 bytes`);
  }
  if (!clientMessageId || clientMessageId.length > 128) {
    throw publicError('client_message_id_invalid', 'client_message_id is required and limited to 128 characters');
  }
  const visibility = body.private === true || body.visibility === 'private' ? 'private' : 'public';
  const contentType = String(body.content_type || 'text') as MessageInput['content_type'];
  if (!SUPPORT_MESSAGE_CONTENT_TYPES.includes(contentType)) {
    throw publicError('message_content_type_invalid', 'Message content type is invalid');
  }
  const replyToMessageId = typeof body.reply_to_message_id === 'string' ? body.reply_to_message_id.trim() : '';
  if (replyToMessageId.length > 255) throw publicError('reply_to_message_id_invalid', 'Reply message id is invalid');
  const metadata = body.metadata == null ? {} : body.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || new TextEncoder().encode(JSON.stringify(metadata)).byteLength > SUPPORT_LIMITS.metadataBytesMaximum) {
    throw publicError('message_metadata_invalid', 'Message metadata must be an object under 32 KB');
  }
  return {
    attachments,
    body: text || null,
    attachment_key: attachments[0]?.key || null,
    attachment_name: attachments[0]?.name || null,
    attachment_content_type: attachments[0]?.content_type || null,
    client_message_id: clientMessageId,
    visibility,
    content_type: contentType,
    reply_to_message_id: replyToMessageId || null,
    metadata: metadata as Record<string, unknown>,
  };
}

function parseAttachments(body: Record<string, unknown>, compatibilityKey: string) {
  const raw = Array.isArray(body.attachments)
    ? body.attachments
    : compatibilityKey
      ? [{
          key: compatibilityKey,
          name: body.attachment_name,
          content_type: body.attachment_content_type,
        }]
      : [];
  if (raw.length > 50) {
    throw publicError('attachments_invalid', 'A message supports at most 50 attachments');
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw publicError('attachments_invalid', `Attachment ${index + 1} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const key = String(record.key || record.storage_key || '').trim();
    if (!validAttachmentKey(key)) {
      throw publicError('attachment_key_invalid', `Attachment ${index + 1} key is invalid`);
    }
    const name = record.name == null && record.file_name == null
      ? null
      : String(record.name || record.file_name).slice(0, 255);
    const contentType = record.content_type == null
      ? null
      : String(record.content_type).slice(0, 128);
    return { key, name, content_type: contentType };
  });
}

function validAttachmentKey(value: string): boolean {
  if (value.length > 512 || !/^attachments\/[a-zA-Z0-9/_.-]+$/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

export function safeFilename(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return normalized || 'attachment';
}

export async function readJsonObject(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const bytes = await readBytesLimited(request, maxBytes, 'request_too_large', `Request body is limited to ${maxBytes} bytes`);
  if (!bytes.byteLength) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw publicError('json_invalid', 'Request body must contain valid JSON', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw publicError('json_invalid', 'Request body must contain a JSON object', 400);
  }
  return parsed as Record<string, unknown>;
}

export async function readBytesLimited(
  request: Request,
  maxBytes: number,
  code = 'attachment_too_large',
  message = 'Request body is too large',
) {
  const announced = Number(request.headers.get('Content-Length') || 0);
  if (announced > maxBytes) throw publicError(code, message, 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(message);
        throw publicError(code, message, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
