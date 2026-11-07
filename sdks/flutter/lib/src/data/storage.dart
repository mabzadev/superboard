import 'dart:typed_data';

import 'transport.dart';

typedef SuperBoardUploadProgress = void Function(int sentBytes, int totalBytes);

const int _mebibyte = 1024 * 1024;

enum SuperBoardImageFit {
  scaleDown('scale-down'),
  contain('contain'),
  cover('cover'),
  crop('crop'),
  pad('pad');

  const SuperBoardImageFit(this.wireValue);

  final String wireValue;
}

enum SuperBoardImageFormat { webp, avif, jpeg, png }

class SuperBoardImageTransform {
  const SuperBoardImageTransform({
    this.width,
    this.height,
    this.fit,
    this.format,
    this.quality,
  });

  final int? width;
  final int? height;
  final SuperBoardImageFit? fit;
  final SuperBoardImageFormat? format;
  final int? quality;

  Map<String, String> toQuery() => {
    if (width != null) 'width': '$width',
    if (height != null) 'height': '$height',
    if (fit != null) 'fit': fit!.wireValue,
    if (format != null) 'format': format!.name,
    if (quality != null) 'quality': '$quality',
  };
}

class SuperBoardStorageObject {
  const SuperBoardStorageObject({
    required this.bucket,
    required this.path,
    required this.contentType,
    required this.size,
    required this.etag,
    this.ownerId,
    this.createdAt,
    this.updatedAt,
  });

  factory SuperBoardStorageObject.fromJson(Map<String, dynamic> json) =>
      SuperBoardStorageObject(
        bucket: json['bucket']?.toString() ?? '',
        path: json['path']?.toString() ?? '',
        ownerId: optionalString(json['owner_id']),
        contentType:
            json['content_type']?.toString() ?? 'application/octet-stream',
        size: (json['size'] as num?)?.toInt() ?? 0,
        etag: json['etag']?.toString() ?? '',
        createdAt: optionalDate(json['created_at']),
        updatedAt: optionalDate(json['updated_at']),
      );

  final String bucket;
  final String path;
  final String? ownerId;
  final String contentType;
  final int size;
  final String etag;
  final DateTime? createdAt;
  final DateTime? updatedAt;
}

class SuperBoardStoragePage {
  const SuperBoardStoragePage({required this.items, this.nextCursor});

  final List<SuperBoardStorageObject> items;
  final String? nextCursor;

  bool get hasMore => nextCursor != null;
}

class SuperBoardBucketInfo {
  const SuperBoardBucketInfo({
    required this.name,
    required this.isPublic,
    required this.maxBytes,
    required this.allowedTypes,
  });

  factory SuperBoardBucketInfo.fromJson(Map<String, dynamic> json) {
    final allowed = json['allowed_types'];
    return SuperBoardBucketInfo(
      name: json['name']?.toString() ?? '',
      isPublic: json['public'] == true,
      maxBytes: (json['max_bytes'] as num?)?.toInt() ?? 0,
      allowedTypes: allowed is List
          ? allowed.map((type) => type.toString()).toList(growable: false)
          : const [],
    );
  }

  final String name;
  final bool isPublic;
  final int maxBytes;
  final List<String> allowedTypes;
}

class SuperBoardSignedUrl {
  const SuperBoardSignedUrl({required this.url, required this.expiresAt});

  final Uri url;
  final DateTime expiresAt;
}

class SuperBoardUploadPart {
  const SuperBoardUploadPart({
    required this.partNumber,
    required this.etag,
    required this.size,
  });

  factory SuperBoardUploadPart.fromJson(Map<String, dynamic> json) =>
      SuperBoardUploadPart(
        partNumber: (json['part_number'] as num?)?.toInt() ?? 0,
        etag: json['etag']?.toString() ?? '',
        size: (json['size'] as num?)?.toInt() ?? 0,
      );

  final int partNumber;
  final String etag;
  final int size;
}

class SuperBoardUploadStatus {
  const SuperBoardUploadStatus({
    required this.uploadId,
    required this.path,
    required this.parts,
    this.expiresAt,
  });

  factory SuperBoardUploadStatus.fromJson(Map<String, dynamic> json) =>
      SuperBoardUploadStatus(
        uploadId: json['upload_id']?.toString() ?? '',
        path: json['path']?.toString() ?? '',
        expiresAt: optionalDate(json['expires_at']),
        parts: asObjectList(
          json['parts'] ?? const <Object?>[],
        ).map(SuperBoardUploadPart.fromJson).toList(growable: false),
      );

  final String uploadId;
  final String path;
  final DateTime? expiresAt;
  final List<SuperBoardUploadPart> parts;
}

/// Bytes read part by part during a resumable upload. Implement it to stream
/// a file without loading it into memory.
abstract class SuperBoardUploadSource {
  const SuperBoardUploadSource();

  factory SuperBoardUploadSource.bytes(Uint8List bytes) = _BytesUploadSource;

  int get length;

  /// Returns the bytes from [start] inclusive to [end] exclusive.
  Future<Uint8List> read(int start, int end);
}

class _BytesUploadSource extends SuperBoardUploadSource {
  const _BytesUploadSource(this._bytes);

  final Uint8List _bytes;

  @override
  int get length => _bytes.length;

  @override
  Future<Uint8List> read(int start, int end) =>
      Future.value(Uint8List.sublistView(_bytes, start, end));
}

class SuperBoardStorage {
  SuperBoardStorage(this._transport);

  final SuperBoardDataTransport _transport;

  SuperBoardStorageBucket from(String bucket) {
    if (bucket.isEmpty || bucket.contains('/')) {
      throw ArgumentError.value(bucket, 'bucket', 'Invalid bucket name');
    }
    return SuperBoardStorageBucket._(_transport, bucket);
  }

  Future<List<SuperBoardBucketInfo>> listBuckets() async => itemsOf(
    await _transport.sendJson('GET', _transport.uri(['storage', 'buckets'])),
  ).map(SuperBoardBucketInfo.fromJson).toList(growable: false);
}

class SuperBoardStorageBucket {
  SuperBoardStorageBucket._(this._transport, this.name);

  static const int defaultPartSize = 8 * _mebibyte;
  static const int minimumPartSize = 5 * _mebibyte;
  static const int _maximumParts = 10000;

  final SuperBoardDataTransport _transport;
  final String name;

  Future<SuperBoardStorageObject> upload(
    String path,
    Uint8List bytes, {
    String contentType = 'application/octet-stream',
    bool upsert = false,
  }) async => SuperBoardStorageObject.fromJson(
    asObject(
      await _transport.sendJson(
        'PUT',
        _objectUri('object', path),
        bytes: bytes,
        headers: {'Content-Type': contentType, if (upsert) 'x-upsert': 'true'},
      ),
    ),
  );

  /// Sends [source] in parts of [partSize] bytes. Pass the identifier given
  /// to [onUploadCreated] as [resumeUploadId] to continue an interrupted
  /// upload of the same source; parts already received are skipped.
  Future<SuperBoardStorageObject> uploadResumable(
    String path,
    SuperBoardUploadSource source, {
    String contentType = 'application/octet-stream',
    bool upsert = false,
    int partSize = defaultPartSize,
    String? resumeUploadId,
    void Function(String uploadId)? onUploadCreated,
    SuperBoardUploadProgress? onProgress,
  }) async {
    final total = source.length;
    if (total <= 0) {
      throw ArgumentError.value(source, 'source', 'The source is empty');
    }
    if (partSize < minimumPartSize) {
      throw RangeError.range(
        partSize,
        minimumPartSize,
        null,
        'partSize',
        'Parts have at least 5 MiB',
      );
    }
    final String uploadId;
    var size = partSize;
    final received = <int, int>{};
    if (resumeUploadId != null) {
      final status = await uploadStatus(resumeUploadId);
      if (status.path != path) {
        throw ArgumentError.value(
          resumeUploadId,
          'resumeUploadId',
          'This upload belongs to another path',
        );
      }
      uploadId = status.uploadId;
      for (final part in status.parts) {
        received[part.partNumber] = part.size;
      }
      final first = received[1];
      if (first != null) size = first < total ? first : total;
    } else {
      final started = asObject(
        await _transport.sendJson(
          'POST',
          _transport.uri(['storage', 'uploads', name]),
          json: {'path': path, 'content_type': contentType, 'upsert': upsert},
        ),
      );
      uploadId = started['upload_id']?.toString() ?? '';
      if (uploadId.isEmpty) {
        throw const SuperBoardDataException(
          'server_response_invalid',
          'SuperBoard did not return an upload ID',
        );
      }
      final minimum = (started['minimum_part_size'] as num?)?.toInt() ?? 0;
      if (size < minimum) size = minimum;
      onUploadCreated?.call(uploadId);
    }
    final count = (total + size - 1) ~/ size;
    if (count > _maximumParts) {
      throw RangeError.value(
        partSize,
        'partSize',
        'The source needs more than $_maximumParts parts',
      );
    }
    int expected(int number) =>
        number < count ? size : total - (count - 1) * size;
    var sent = 0;
    for (var number = 1; number <= count; number += 1) {
      if (received[number] == expected(number)) sent += expected(number);
    }
    onProgress?.call(sent, total);
    for (var number = 1; number <= count; number += 1) {
      final length = expected(number);
      if (received[number] == length) continue;
      final start = (number - 1) * size;
      final bytes = await source.read(start, start + length);
      if (bytes.length != length) {
        throw StateError('The upload source returned ${bytes.length} bytes');
      }
      await _transport.sendJson(
        'PUT',
        _transport.uri(['storage', 'uploads', name, uploadId, '$number']),
        bytes: bytes,
        headers: const {'Content-Type': 'application/octet-stream'},
      );
      sent += length;
      onProgress?.call(sent, total);
    }
    return SuperBoardStorageObject.fromJson(
      asObject(
        await _transport.sendJson(
          'POST',
          _transport.uri(['storage', 'uploads', name, uploadId, 'complete']),
        ),
      ),
    );
  }

  Future<SuperBoardUploadStatus> uploadStatus(String uploadId) async =>
      SuperBoardUploadStatus.fromJson(
        asObject(
          await _transport.sendJson(
            'GET',
            _transport.uri(['storage', 'uploads', name, uploadId]),
          ),
        ),
      );

  Future<void> abortUpload(String uploadId) async {
    await _transport.sendJson(
      'DELETE',
      _transport.uri(['storage', 'uploads', name, uploadId]),
    );
  }

  Future<Uint8List> download(
    String path, {
    SuperBoardImageTransform? transform,
  }) async {
    final response = await _transport.send(
      'GET',
      _objectUri('object', path, transform?.toQuery()),
    );
    throwIfFailed(response);
    return response.bodyBytes;
  }

  Future<SuperBoardStoragePage> list({
    String? prefix,
    int? limit,
    String? cursor,
  }) async {
    if (limit != null) RangeError.checkValueInInterval(limit, 1, 1000, 'limit');
    final json = asObject(
      await _transport.sendJson(
        'GET',
        _transport.uri(
          ['storage', 'list', name],
          {
            if (prefix != null && prefix.isNotEmpty) 'prefix': prefix,
            if (limit != null) 'limit': '$limit',
            if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
          },
        ),
      ),
    );
    return SuperBoardStoragePage(
      items: asObjectList(
        json['items'],
      ).map(SuperBoardStorageObject.fromJson).toList(growable: false),
      nextCursor: optionalString(json['nextCursor']),
    );
  }

  Future<SuperBoardStorageObject> remove(String path) async =>
      SuperBoardStorageObject.fromJson(
        asObject(
          asObject(
            await _transport.sendJson('DELETE', _objectUri('object', path)),
          )['item'],
        ),
      );

  Future<SuperBoardSignedUrl> createSignedUrl(
    String path, {
    Duration expiresIn = const Duration(hours: 1),
    SuperBoardImageTransform? transform,
  }) async {
    final seconds = expiresIn.inSeconds;
    RangeError.checkValueInInterval(seconds, 1, 7 * 24 * 60 * 60, 'expiresIn');
    final transformQuery = transform?.toQuery() ?? const {};
    final json = asObject(
      await _transport.sendJson(
        'POST',
        _objectUri('sign', path),
        json: {
          'expires_in': seconds,
          if (transformQuery.isNotEmpty) 'transform': transformQuery,
        },
      ),
    );
    final url = Uri.tryParse(json['url']?.toString() ?? '');
    final expiresAt = optionalDate(json['expires_at']);
    if (url == null || !url.hasScheme || expiresAt == null) {
      throw const SuperBoardDataException(
        'server_response_invalid',
        'SuperBoard returned an invalid signed URL',
      );
    }
    return SuperBoardSignedUrl(url: url, expiresAt: expiresAt);
  }

  /// URL of an object in a public bucket. It needs no request and no token.
  Uri publicUrl(
    int projectId,
    String path, {
    SuperBoardImageTransform? transform,
  }) {
    if (projectId <= 0) {
      throw ArgumentError.value(projectId, 'projectId', 'Must be positive');
    }
    return _transport.uri([
      'storage',
      'public',
      '$projectId',
      name,
      ..._pathSegments(path),
    ], transform?.toQuery());
  }

  Uri _objectUri(String family, String path, [Map<String, Object>? query]) =>
      _transport.uri(['storage', family, name, ..._pathSegments(path)], query);
}

List<String> _pathSegments(String path) {
  if (path.isEmpty) {
    throw ArgumentError.value(path, 'path', 'Object path cannot be empty');
  }
  return path.split('/');
}
