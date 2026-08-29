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
    attachments?: Array<{
      key: string;
      name: string | null;
      content_type: string | null;
    }>;
    attachment_key: string | null;
    attachment_name: string | null;
    attachment_content_type: string | null;
  },
): MessageAttachment[] {
  const attachments = input.attachments?.length
    ? input.attachments
    : input.attachment_key
      ? [{
          key: input.attachment_key,
          name: input.attachment_name,
          content_type: input.attachment_content_type,
        }]
      : [];
  return attachments.map((attachment, position) => ({
    id: `${messageId}:attachment:${position}`,
    storage_key: attachment.key,
    file_name: attachment.name || 'attachment',
    content_type: attachment.content_type || 'application/octet-stream',
    byte_size: null,
    position,
  }));
}
