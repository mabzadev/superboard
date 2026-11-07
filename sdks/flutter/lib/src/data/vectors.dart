import 'transport.dart';

class SuperBoardVectorItem {
  const SuperBoardVectorItem({
    required this.id,
    this.text,
    this.values,
    this.metadata = const {},
  }) : assert(text != null || values != null, 'Provide text or values');

  final String id;

  /// Text embedded on the server when [values] is not given.
  final String? text;
  final List<double>? values;

  /// Strings, numbers, booleans or null, usable as query filters.
  final Map<String, Object?> metadata;

  Map<String, Object?> toJson() => {
    'id': id,
    if (text != null) 'text': text,
    if (values != null) 'values': values,
    if (metadata.isNotEmpty) 'metadata': metadata,
  };
}

class SuperBoardVectorMatch {
  const SuperBoardVectorMatch({
    required this.id,
    required this.score,
    this.content,
    this.metadata = const {},
    this.ownerId,
  });

  factory SuperBoardVectorMatch.fromJson(Map<String, dynamic> json) {
    final metadata = json['metadata'];
    return SuperBoardVectorMatch(
      id: json['id']?.toString() ?? '',
      score: (json['score'] as num?)?.toDouble() ?? 0,
      content: optionalString(json['content']),
      metadata: metadata is Map ? metadata.cast<String, dynamic>() : const {},
      ownerId: optionalString(json['owner_id']),
    );
  }

  final String id;
  final double score;
  final String? content;
  final Map<String, dynamic> metadata;
  final String? ownerId;
}

class SuperBoardEmbeddings {
  const SuperBoardEmbeddings({
    required this.model,
    required this.dimensions,
    required this.embeddings,
  });

  final String model;
  final int dimensions;

  /// One vector per input text, in input order.
  final List<List<double>> embeddings;
}

class SuperBoardVectors {
  SuperBoardVectors(this._transport);

  final SuperBoardDataTransport _transport;

  SuperBoardVectorCollection from(String collection) {
    if (collection.isEmpty || collection.contains('/')) {
      throw ArgumentError.value(collection, 'collection', 'Invalid name');
    }
    return SuperBoardVectorCollection._(_transport, collection);
  }
}

class SuperBoardVectorCollection {
  SuperBoardVectorCollection._(this._transport, this.name);

  final SuperBoardDataTransport _transport;
  final String name;

  /// Indexes up to 50 items and returns their IDs.
  Future<List<String>> upsert(Iterable<SuperBoardVectorItem> items) async {
    final body = items.map((item) => item.toJson()).toList(growable: false);
    if (body.isEmpty) {
      throw ArgumentError.value(items, 'items', 'Provide at least one item');
    }
    return itemsOf(
      await _transport.sendJson(
        'POST',
        _transport.uri(['vectors', name, 'upsert']),
        json: {'items': body},
      ),
    ).map((item) => item['id'].toString()).toList(growable: false);
  }

  /// Returns the [topK] closest items to [text] or [values]. [filter] keeps
  /// items whose metadata holds every given value.
  Future<List<SuperBoardVectorMatch>> query({
    String? text,
    List<double>? values,
    int topK = 10,
    Map<String, Object?>? filter,
  }) async {
    if ((text == null) == (values == null)) {
      throw ArgumentError('Provide either text or values');
    }
    RangeError.checkValueInInterval(topK, 1, 50, 'topK');
    return itemsOf(
      await _transport.sendJson(
        'POST',
        _transport.uri(['vectors', name, 'query']),
        json: {
          if (text != null) 'text': text,
          if (values != null) 'values': values,
          'top_k': topK,
          if (filter != null && filter.isNotEmpty) 'filter': filter,
        },
      ),
    ).map(SuperBoardVectorMatch.fromJson).toList(growable: false);
  }

  Future<void> remove(String id) async {
    if (id.isEmpty) throw ArgumentError.value(id, 'id', 'ID cannot be empty');
    await _transport.sendJson('DELETE', _transport.uri(['vectors', name, id]));
  }
}

class SuperBoardAi {
  SuperBoardAi(this._transport);

  final SuperBoardDataTransport _transport;

  /// Embeds a string or up to 50 strings. Requires a signed-in user.
  Future<SuperBoardEmbeddings> embeddings(Object input) async {
    final Object body;
    if (input is String) {
      body = input;
    } else if (input is Iterable<Object?> && input.every((i) => i is String)) {
      body = input.toList(growable: false);
    } else {
      throw ArgumentError.value(input, 'input', 'Expected text or texts');
    }
    final json = asObject(
      await _transport.sendJson(
        'POST',
        _transport.uri(['ai', 'embeddings']),
        json: {'input': body},
      ),
    );
    final data = asObjectList(json['data'])
      ..sort(
        (left, right) => ((left['index'] as num?) ?? 0).compareTo(
          (right['index'] as num?) ?? 0,
        ),
      );
    return SuperBoardEmbeddings(
      model: json['model']?.toString() ?? '',
      dimensions: (json['dimensions'] as num?)?.toInt() ?? 0,
      embeddings: List.unmodifiable(
        data.map((item) {
          final embedding = item['embedding'];
          if (embedding is! List) {
            throw const SuperBoardDataException(
              'server_response_invalid',
              'SuperBoard returned an invalid embedding',
            );
          }
          return List<double>.unmodifiable(
            embedding.map((value) => (value as num).toDouble()),
          );
        }),
      ),
    );
  }
}
