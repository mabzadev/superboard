import 'dart:convert';

class SuperBoardSupportRealtimeEvent {
  const SuperBoardSupportRealtimeEvent({
    required this.schemaVersion,
    required this.type,
    required this.eventId,
    required this.conversationId,
    required this.occurredAt,
    required this.data,
  });

  factory SuperBoardSupportRealtimeEvent.fromJson(Map<String, dynamic> json) {
    const allowed = {
      'connected',
      'message.created',
      'message.updated',
      'message.deleted',
      'conversation.updated',
      'typing.started',
      'typing.stopped',
      'conversation.read',
      'delivery.updated',
      'presence.updated',
      'assignment.updated',
      'error',
    };
    final type = json['type']?.toString() ?? '';
    final eventId = json['event_id']?.toString() ?? '';
    final conversationId = json['conversation_id']?.toString() ?? '';
    final occurredAt = DateTime.tryParse(json['occurred_at']?.toString() ?? '');
    if (json['schema_version'] != 1 || !allowed.contains(type) ||
        eventId.isEmpty || conversationId.isEmpty || occurredAt == null) {
      throw const FormatException('Invalid Support realtime event');
    }
    return SuperBoardSupportRealtimeEvent(
      schemaVersion: 1,
      type: type,
      eventId: eventId,
      conversationId: conversationId,
      occurredAt: occurredAt.toUtc(),
      data: Map.unmodifiable(Map<String, dynamic>.from(json)),
    );
  }

  final int schemaVersion;
  final String type;
  final String eventId;
  final String conversationId;
  final DateTime occurredAt;
  final Map<String, dynamic> data;

  Map<String, dynamic> toJson() => Map<String, dynamic>.from(data);
}

class SuperBoardConversation {
  const SuperBoardConversation({
    required this.id,
    required this.status,
    required this.priority,
    this.unreadCount = 0,
    this.displayId,
    this.externalId,
    this.subject,
    this.inboxId,
    this.assignedAgentId,
    this.assignedTeamId,
    this.customAttributes = const {},
    this.snoozedUntil,
    this.lastMessagePreview,
    this.lastMessageAt,
  });

  factory SuperBoardConversation.fromJson(Map<String, dynamic> json) =>
      SuperBoardConversation(
        id: json['id']?.toString() ?? '',
        displayId: (json['display_id'] as num?)?.toInt(),
        externalId: json['external_id']?.toString(),
        status: json['status']?.toString() ?? 'open',
        priority: json['priority']?.toString() ?? 'normal',
        unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
        subject: json['subject']?.toString(),
        inboxId: json['inbox_id']?.toString(),
        assignedAgentId: json['assigned_agent_id']?.toString(),
        assignedTeamId: json['assigned_team_id']?.toString(),
        customAttributes: _objectValue(
          json['custom_attributes_json'],
          json['custom_attributes'],
        ),
        snoozedUntil: json['snoozed_until']?.toString(),
        lastMessagePreview: json['last_message_preview']?.toString(),
        lastMessageAt: json['last_message_at']?.toString(),
      );

  final String id;
  final int? displayId;
  final String? externalId;
  final String status;
  final String priority;
  final int unreadCount;
  final String? subject;
  final String? inboxId;
  final String? assignedAgentId;
  final String? assignedTeamId;
  final Map<String, dynamic> customAttributes;
  final String? snoozedUntil;
  final String? lastMessagePreview;
  final String? lastMessageAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'display_id': displayId,
    'external_id': externalId,
    'status': status,
    'priority': priority,
    'unread_count': unreadCount,
    'subject': subject,
    'inbox_id': inboxId,
    'assigned_agent_id': assignedAgentId,
    'assigned_team_id': assignedTeamId,
    'custom_attributes': customAttributes,
    'snoozed_until': snoozedUntil,
    'last_message_preview': lastMessagePreview,
    'last_message_at': lastMessageAt,
  };
}

class SuperBoardMessage {
  const SuperBoardMessage({
    required this.id,
    required this.conversationId,
    required this.senderKind,
    required this.sequence,
    required this.createdAt,
    this.body,
    this.sourceId,
    this.providerMessageId,
    this.attachmentName,
    this.attachmentContentType,
    this.attachments = const [],
    this.visibility = 'public',
    this.contentType = 'text',
    this.replyToMessageId,
    this.metadata = const {},
    this.deliveryStatus,
  });

  factory SuperBoardMessage.fromJson(Map<String, dynamic> json) =>
      SuperBoardMessage(
        id: json['id']?.toString() ?? '',
        conversationId: json['conversation_id']?.toString() ?? '',
        sourceId: json['source_id']?.toString(),
        providerMessageId: json['provider_message_id']?.toString(),
        senderKind: json['sender_kind']?.toString() ?? 'system',
        sequence: (json['sequence'] as num?)?.toInt() ?? 0,
        createdAt: json['created_at']?.toString() ?? '',
        body: json['body']?.toString(),
        attachmentName: json['attachment_name']?.toString(),
        attachmentContentType: json['attachment_content_type']?.toString(),
        attachments: _decodeAttachments(json),
        visibility: json['visibility']?.toString() ?? 'public',
        contentType: json['content_type']?.toString() ?? 'text',
        replyToMessageId: json['reply_to_message_id']?.toString(),
        metadata: _objectValue(json['metadata_json'], json['metadata']),
        deliveryStatus: json['delivery_status']?.toString(),
      );

  final String id;
  final String conversationId;
  final String? sourceId;
  final String? providerMessageId;
  final String senderKind;
  final int sequence;
  final String createdAt;
  final String? body;
  final String? attachmentName;
  final String? attachmentContentType;
  final List<SuperBoardMessageAttachment> attachments;
  final String visibility;
  final String contentType;
  final String? replyToMessageId;
  final Map<String, dynamic> metadata;
  final String? deliveryStatus;

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversation_id': conversationId,
    'source_id': sourceId,
    'provider_message_id': providerMessageId,
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
    'delivery_status': deliveryStatus,
  };
}

class SuperBoardMessageAttachment {
  const SuperBoardMessageAttachment({
    required this.id,
    required this.fileName,
    required this.contentType,
    required this.position,
    this.byteSize,
    this.downloadUrl,
  });

  factory SuperBoardMessageAttachment.fromJson(Map<String, dynamic> json) =>
      SuperBoardMessageAttachment(
        id: json['id']?.toString() ?? '',
        fileName: json['file_name']?.toString() ?? 'attachment',
        contentType:
            json['content_type']?.toString() ?? 'application/octet-stream',
        byteSize: (json['byte_size'] as num?)?.toInt(),
        position: (json['position'] as num?)?.toInt() ?? 0,
        downloadUrl: json['download_url']?.toString(),
      );

  final String id;
  final String fileName;
  final String contentType;
  final int? byteSize;
  final int position;
  final String? downloadUrl;

  Map<String, dynamic> toJson() => {
    'id': id,
    'file_name': fileName,
    'content_type': contentType,
    'byte_size': byteSize,
    'position': position,
    'download_url': downloadUrl,
  };
}

class SuperBoardSupportContact {
  const SuperBoardSupportContact({
    required this.id,
    this.name,
    this.email,
    this.phone,
    this.avatarUrl,
    this.customAttributes = const {},
  });

  factory SuperBoardSupportContact.fromJson(Map<String, dynamic> json) =>
      SuperBoardSupportContact(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString(),
        email: json['email']?.toString(),
        phone: json['phone']?.toString(),
        avatarUrl: json['avatar_url']?.toString(),
        customAttributes: _objectValue(
          json['custom_attributes_json'],
          json['custom_attributes'],
        ),
      );

  final String id;
  final String? name;
  final String? email;
  final String? phone;
  final String? avatarUrl;
  final Map<String, dynamic> customAttributes;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'email': email,
    'phone': phone,
    'avatar_url': avatarUrl,
    'custom_attributes': customAttributes,
  };
}

class SuperBoardSupportHelpArticle {
  const SuperBoardSupportHelpArticle({
    required this.id,
    required this.title,
    required this.slug,
    this.summary,
    this.content,
    this.locale,
    this.categoryId,
  });

  factory SuperBoardSupportHelpArticle.fromJson(Map<String, dynamic> json) =>
      SuperBoardSupportHelpArticle(
        id: json['id']?.toString() ?? '',
        title: json['title']?.toString() ?? '',
        slug: json['slug']?.toString() ?? '',
        summary: json['summary']?.toString(),
        content: json['content']?.toString(),
        locale: json['locale']?.toString(),
        categoryId: json['category_id']?.toString(),
      );

  final String id;
  final String title;
  final String slug;
  final String? summary;
  final String? content;
  final String? locale;
  final String? categoryId;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'slug': slug,
    'summary': summary,
    'content': content,
    'locale': locale,
    'category_id': categoryId,
  };
}

List<SuperBoardMessageAttachment> _decodeAttachments(
  Map<String, dynamic> json,
) {
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
            (item) => SuperBoardMessageAttachment.fromJson(
              item.map((key, value) => MapEntry(key.toString(), value)),
            ),
          )
          .toList(growable: false)
        ..sort((left, right) => left.position.compareTo(right.position));
  return attachments;
}

Map<String, dynamic> decodeSupportObject(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! Map) {
    throw const FormatException('Expected a JSON object');
  }
  return decoded.map((key, value) => MapEntry(key.toString(), value));
}

Map<String, dynamic> _objectValue(Object? encoded, Object? value) {
  if (encoded is String) {
    try {
      return decodeSupportObject(encoded);
    } catch (_) {
      return const {};
    }
  }
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return const {};
}
