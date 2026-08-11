export const MESSAGE_WITH_ATTACHMENTS = `
  messages.*,
  COALESCE((
    SELECT json_group_array(json_object(
      'id', attachment.id,
      'storage_key', attachment.storage_key,
      'file_name', attachment.file_name,
      'content_type', attachment.content_type,
      'byte_size', attachment.byte_size,
      'position', attachment.position
    ))
    FROM support_message_attachments attachment
    WHERE attachment.message_id = messages.id
  ), '[]') AS attachments_json
`;

export type MessageAttachment = {
  id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  byte_size: number | null;
  position: number;
};

export function localAttachment(
  messageId: string,
  input: {
    attachment_key: string | null;
    attachment_name: string | null;
    attachment_content_type: string | null;
  },
): MessageAttachment[] {
  if (!input.attachment_key) return [];
  return [{
    id: `${messageId}:attachment:0`,
    storage_key: input.attachment_key,
    file_name: input.attachment_name || 'attachment',
    content_type: input.attachment_content_type || 'application/octet-stream',
    byte_size: null,
    position: 0,
  }];
}
