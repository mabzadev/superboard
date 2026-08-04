import { publicError } from './auth';

export const MAX_MESSAGE_LENGTH = 8_000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type MessageInput = {
  body: string | null;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_content_type: string | null;
  client_message_id: string;
};

export function parseMessageInput(value: unknown): MessageInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const attachmentKey = typeof body.attachment_key === 'string' ? body.attachment_key.trim() : '';
  const clientMessageId = typeof body.client_message_id === 'string' ? body.client_message_id.trim() : '';
  if ((!text && !attachmentKey) || text.length > MAX_MESSAGE_LENGTH) {
    throw publicError('message_invalid', `A message or attachment is required; text is limited to ${MAX_MESSAGE_LENGTH} characters`);
  }
  if (!clientMessageId || clientMessageId.length > 128) {
    throw publicError('client_message_id_invalid', 'client_message_id is required and limited to 128 characters');
  }
  if (attachmentKey && !validAttachmentKey(attachmentKey)) {
    throw publicError('attachment_key_invalid', 'Attachment key is invalid');
  }
  return {
    body: text || null,
    attachment_key: attachmentKey || null,
    attachment_name: typeof body.attachment_name === 'string' ? body.attachment_name.slice(0, 255) : null,
    attachment_content_type: typeof body.attachment_content_type === 'string' ? body.attachment_content_type.slice(0, 128) : null,
    client_message_id: clientMessageId,
  };
}

function validAttachmentKey(value: string): boolean {
  if (value.length > 512 || !/^attachments\/[a-zA-Z0-9/_.-]+$/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

export function safeFilename(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return normalized || 'attachment';
}
