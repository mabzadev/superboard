import 'dart:convert';

class OpenGrowConversation {
  const OpenGrowConversation({
    required this.id,
    required this.status,
    required this.priority,
    this.unreadCount = 0,
    this.subject,
    this.lastMessagePreview,
    this.lastMessageAt,
  });

  factory OpenGrowConversation.fromJson(Map<String, dynamic> json) =>
      OpenGrowConversation(
        id: json['id'] as String,
        status: json['status'] as String? ?? 'open',
        priority: json['priority'] as String? ?? 'normal',
        unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
        subject: json['subject'] as String?,
        lastMessagePreview: json['last_message_preview'] as String?,
        lastMessageAt: json['last_message_at'] as String?,
      );

  final String id;
  final String status;
  final String priority;
  final int unreadCount;
  final String? subject;
  final String? lastMessagePreview;
  final String? lastMessageAt;
}

class OpenGrowMessage {
  const OpenGrowMessage({
    required this.id,
    required this.conversationId,
    required this.senderKind,
    required this.sequence,
    required this.createdAt,
    this.body,
    this.attachmentName,
    this.attachmentContentType,
  });

  factory OpenGrowMessage.fromJson(Map<String, dynamic> json) =>
      OpenGrowMessage(
        id: json['id'] as String,
        conversationId: json['conversation_id'] as String,
        senderKind: json['sender_kind'] as String,
        sequence: (json['sequence'] as num).toInt(),
        createdAt: json['created_at'] as String,
        body: json['body'] as String?,
        attachmentName: json['attachment_name'] as String?,
        attachmentContentType: json['attachment_content_type'] as String?,
      );

  final String id;
  final String conversationId;
  final String senderKind;
  final int sequence;
  final String createdAt;
  final String? body;
  final String? attachmentName;
  final String? attachmentContentType;

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversation_id': conversationId,
    'sender_kind': senderKind,
    'sequence': sequence,
    'created_at': createdAt,
    'body': body,
    'attachment_name': attachmentName,
    'attachment_content_type': attachmentContentType,
  };
}

Map<String, dynamic> decodeObject(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! Map<String, dynamic>) {
    throw const FormatException('Expected a JSON object');
  }
  return decoded;
}
