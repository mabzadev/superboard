import 'dart:convert';

class OpenGrowConversation {
  const OpenGrowConversation({
    required this.id,
    required this.status,
    required this.priority,
    this.unreadCount = 0,
    this.subject,
    this.inboxId,
    this.assignedTeamId,
    this.customAttributes = const {},
    this.snoozedUntil,
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
        inboxId: json['inbox_id'] as String?,
        assignedTeamId: json['assigned_team_id'] as String?,
        customAttributes: json['custom_attributes_json'] is String
            ? decodeObject(json['custom_attributes_json'] as String)
            : (json['custom_attributes'] as Map<String, dynamic>? ?? const {}),
        snoozedUntil: json['snoozed_until'] as String?,
        lastMessagePreview: json['last_message_preview'] as String?,
        lastMessageAt: json['last_message_at'] as String?,
      );

  final String id;
  final String status;
  final String priority;
  final int unreadCount;
  final String? subject;
  final String? inboxId;
  final String? assignedTeamId;
  final Map<String, dynamic> customAttributes;
  final String? snoozedUntil;
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
    this.attachments = const [],
    this.visibility = 'public',
    this.contentType = 'text',
    this.replyToMessageId,
    this.metadata = const {},
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
        attachments: _decodeAttachments(json),
        visibility: json['visibility'] as String? ?? 'public',
        contentType: json['content_type'] as String? ?? 'text',
        replyToMessageId: json['reply_to_message_id'] as String?,
        metadata: json['metadata_json'] is String
            ? decodeObject(json['metadata_json'] as String)
            : (json['metadata'] as Map<String, dynamic>? ?? const {}),
      );

  final String id;
  final String conversationId;
  final String senderKind;
  final int sequence;
  final String createdAt;
  final String? body;
  final String? attachmentName;
  final String? attachmentContentType;
  final List<OpenGrowMessageAttachment> attachments;
  final String visibility;
  final String contentType;
  final String? replyToMessageId;
  final Map<String, dynamic> metadata;

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversation_id': conversationId,
    'sender_kind': senderKind,
    'sequence': sequence,
    'created_at': createdAt,
    'body': body,
    'attachment_name': attachmentName,
    'attachment_content_type': attachmentContentType,
    'attachments': attachments
        .map((item) => item.toJson())
        .toList(growable: false),
    'visibility': visibility,
    'content_type': contentType,
    'reply_to_message_id': replyToMessageId,
    'metadata': metadata,
  };
}

class OpenGrowMessageAttachment {
  const OpenGrowMessageAttachment({
    required this.id,
    required this.fileName,
    required this.contentType,
    required this.position,
    this.byteSize,
  });

  factory OpenGrowMessageAttachment.fromJson(Map<String, dynamic> json) =>
      OpenGrowMessageAttachment(
        id: json['id']?.toString() ?? '',
        fileName: json['file_name']?.toString() ?? 'attachment',
        contentType:
            json['content_type']?.toString() ?? 'application/octet-stream',
        byteSize: (json['byte_size'] as num?)?.toInt(),
        position: (json['position'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String fileName;
  final String contentType;
  final int? byteSize;
  final int position;

  Map<String, dynamic> toJson() => {
    'id': id,
    'file_name': fileName,
    'content_type': contentType,
    'byte_size': byteSize,
    'position': position,
  };
}

List<OpenGrowMessageAttachment> _decodeAttachments(Map<String, dynamic> json) {
  Object? value = json['attachments'];
  if (value == null && json['attachments_json'] is String) {
    try {
      value = jsonDecode(json['attachments_json'] as String);
    } catch (_) {
      value = const [];
    }
  }
  if (value is! List) return const [];
  final attachments =
      value
          .whereType<Map>()
          .map(
            (item) => OpenGrowMessageAttachment.fromJson(
              item.map((key, value) => MapEntry(key.toString(), value)),
            ),
          )
          .toList(growable: false)
        ..sort((left, right) => left.position.compareTo(right.position));
  return attachments;
}

Map<String, dynamic> decodeObject(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! Map<String, dynamic>) {
    throw const FormatException('Expected a JSON object');
  }
  return decoded;
}
