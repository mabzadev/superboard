import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutter/superboard_data.dart';

const _mebibyte = 1024 * 1024;

void main() {
  group('database', () {
    test('encodes filters and sends the SDK identity', () async {
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        return _json({
          'items': [
            {'id': 'r1', 'title': 'Milk'},
          ],
          'nextCursor': 'c2',
          'count': 7,
        });
      }, accessToken: 'app-token');

      final page = await data
          .from('todos')
          .select(['title', 'done'])
          .eq('done', false)
          .gte('priority', 2)
          .lte('priority', 5)
          .lt('due_at', DateTime.utc(2026, 11, 7, 12))
          .ilike('title', '*milk*')
          .inList('tag', ['home', 'a,b', 'say "hi"', ' padded'])
          .not('owner_id', 'is', null)
          .not('status', 'in', ['done', 'archived'])
          .order('created_at', ascending: false)
          .limit(20)
          .count()
          .get();

      final request = requests.single;
      expect(request.method, 'GET');
      expect(request.url.origin, 'https://sdk.example.test');
      expect(request.url.path, '/v1/data/db/todos');
      expect(request.url.queryParametersAll, {
        'done': ['eq.false'],
        'priority': ['gte.2', 'lte.5'],
        'due_at': ['lt.2026-11-07T12:00:00.000Z'],
        'title': ['ilike.*milk*'],
        'tag': ['in.(home,"a,b","say ""hi"""," padded")'],
        'owner_id': ['not.is.null'],
        'status': ['not.in.(done,archived)'],
        'select': ['title,done'],
        'order': ['created_at.desc'],
        'limit': ['20'],
        'count': ['exact'],
      });
      expect(request.headers['PROJECT-KEY'], 'og_app_key');
      expect(request.headers['PLATFORM'], 'ios');
      expect(request.headers['IDENTIFIER'], 'com.example.app');
      expect(request.headers['Authorization'], 'Bearer app-token');
      expect(page.items.single['title'], 'Milk');
      expect(page.nextCursor, 'c2');
      expect(page.count, 7);
      expect(page.hasMore, isTrue);
    });

    test('follows nextCursor without changing the base query', () async {
      final cursors = <String?>[];
      final data = _client((request) async {
        final cursor = request.url.queryParameters['cursor'];
        cursors.add(cursor);
        return cursor == null
            ? _json({
                'items': [
                  {'id': '1'},
                ],
                'nextCursor': 'abc',
              })
            : _json({
                'items': [
                  {'id': '2'},
                ],
              });
      });
      final query = data.from('todos').eq('done', false).limit(1);

      final first = await query.get();
      final second = await query.cursor(first.nextCursor!).get();
      await query.get();

      expect(cursors, [null, 'abc', null]);
      expect(second.items.single['id'], '2');
      expect(second.hasMore, isFalse);
      expect(second.count, isNull);
    });

    test('sends every write to its route', () async {
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        final path = request.url.path;
        if (request.method == 'POST' && request.body.startsWith('[')) {
          return _json({
            'items': [
              {'id': 'a'},
              {'id': 'b'},
            ],
          }, 201);
        }
        if (request.method == 'POST') return _json({'id': 'one'}, 201);
        if (path.endsWith('/r1') && request.method == 'DELETE') {
          return _json({
            'deleted': true,
            'item': {'id': 'r1'},
          });
        }
        if (path.endsWith('/r1')) return _json({'id': 'r1', 'done': true});
        return _json({
          'items': [
            {'id': 'r2'},
          ],
        });
      });
      final todos = data.from('todos');

      final single = await todos.insert({'title': 'Milk'});
      final many = await todos.insert([
        {'id': 'a'},
        {'id': 'b'},
      ], upsert: true);
      final updated = await todos.eq('done', true).update({'archived': true});
      final byId = await todos.updateById('r1', {'done': true});
      final deleted = await todos.lt('priority', 1).delete();
      final removed = await todos.deleteById('r1');

      expect(requests.map((request) => '${request.method} ${request.url}'), [
        'POST https://sdk.example.test/v1/data/db/todos',
        'POST https://sdk.example.test/v1/data/db/todos?upsert=true',
        'PATCH https://sdk.example.test/v1/data/db/todos?done=eq.true',
        'PATCH https://sdk.example.test/v1/data/db/todos/r1',
        'DELETE https://sdk.example.test/v1/data/db/todos?priority=lt.1',
        'DELETE https://sdk.example.test/v1/data/db/todos/r1',
      ]);
      expect(jsonDecode(requests[0].body), {'title': 'Milk'});
      expect(jsonDecode(requests[1].body), hasLength(2));
      expect(jsonDecode(requests[2].body), {'archived': true});
      expect(single.single['id'], 'one');
      expect(many.map((row) => row['id']), ['a', 'b']);
      expect(updated.single['id'], 'r2');
      expect(byId['done'], isTrue);
      expect(deleted.single['id'], 'r2');
      expect(removed['id'], 'r1');
    });

    test(
      'refuses filtered writes without a filter before any request',
      () async {
        var requests = 0;
        final data = _client((_) async {
          requests += 1;
          return _json({'items': <Object?>[]});
        });

        await expectLater(
          data.from('todos').update({'done': true}),
          throwsA(_code('filter_required')),
        );
        await expectLater(
          data.from('todos').delete(),
          throwsA(_code('filter_required')),
        );
        expect(() => data.from('todos').eq('limit', 1), throwsArgumentError);
        expect(() => data.from('Todos'), throwsArgumentError);
        expect(requests, 0);
      },
    );

    test('exposes server errors with their code and request ID', () async {
      final data = _client((request) async {
        if (request.url.path.endsWith('/missing')) {
          return _json(
            {
              'error': {
                'code': 'row_not_found',
                'message': 'Row does not exist',
                'retryable': false,
              },
            },
            404,
            {'x-request-id': 'req-1'},
          );
        }
        return _json({
          'error': 'PROJECT-KEY, PLATFORM and IDENTIFIER required',
        }, 401);
      });

      await expectLater(
        data.from('todos').single('missing'),
        throwsA(
          isA<SuperBoardDataException>()
              .having((error) => error.code, 'code', 'row_not_found')
              .having((error) => error.statusCode, 'statusCode', 404)
              .having((error) => error.retryable, 'retryable', isFalse)
              .having((error) => error.requestId, 'requestId', 'req-1'),
        ),
      );
      await expectLater(
        data.from('todos').get(),
        throwsA(
          isA<SuperBoardDataException>()
              .having((error) => error.code, 'code', 'http_401')
              .having(
                (error) => error.message,
                'message',
                contains('IDENTIFIER'),
              ),
        ),
      );
    });

    test('refreshes the access token once after a 401', () async {
      final authorizations = <String?>[];
      var issued = 0;
      final data = _client((request) async {
        authorizations.add(request.headers['Authorization']);
        if (request.headers['Authorization'] == 'Bearer token-1') {
          return _json({
            'error': {'code': 'token_invalid', 'message': 'Expired'},
          }, 401);
        }
        return _json({'items': <Object?>[]});
      }, accessTokenProvider: () async => 'token-${++issued}');

      await data.from('todos').get();
      await data.from('todos').get();

      expect(authorizations, [
        'Bearer token-1',
        'Bearer token-2',
        'Bearer token-2',
      ]);
    });

    test('calls anonymously without a token', () async {
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        return _json({'items': <Object?>[]});
      });

      await data.from('todos').get();

      expect(requests.single.headers.containsKey('Authorization'), isFalse);
    });
  });

  group('storage', () {
    test('uploads, reads, lists, signs and deletes objects', () async {
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        final path = request.url.path;
        if (path.endsWith('/buckets')) {
          return _json({
            'items': [
              {
                'name': 'avatars',
                'public': true,
                'max_bytes': 1024,
                'allowed_types': ['image/png'],
              },
            ],
          });
        }
        if (path.startsWith('/v1/data/storage/list/')) {
          return _json({
            'items': [_object('user 1/photo.png')],
            'nextCursor': 'user 1/photo.png',
          });
        }
        if (path.startsWith('/v1/data/storage/sign/')) {
          return _json({
            'url': 'https://sdk.example.test/v1/data/storage/signed/tok',
            'expires_at': '2026-11-07T13:00:00.000Z',
          });
        }
        if (request.method == 'GET') {
          return http.Response.bytes([1, 2, 3], 200);
        }
        if (request.method == 'DELETE') {
          return _json({'deleted': true, 'item': _object('user 1/photo.png')});
        }
        return _json(_object('user 1/photo.png'), 201);
      });
      final avatars = data.storage.from('avatars');
      const transform = SuperBoardImageTransform(
        width: 128,
        fit: SuperBoardImageFit.scaleDown,
        format: SuperBoardImageFormat.webp,
      );

      final stored = await avatars.upload(
        'user 1/photo.png',
        Uint8List.fromList([9, 8, 7]),
        contentType: 'image/png',
        upsert: true,
      );
      final bytes = await avatars.download(
        'user 1/photo.png',
        transform: transform,
      );
      final page = await avatars.list(prefix: 'user 1/', limit: 10);
      final signed = await avatars.createSignedUrl(
        'user 1/photo.png',
        expiresIn: const Duration(minutes: 10),
        transform: transform,
      );
      final removed = await avatars.remove('user 1/photo.png');
      final buckets = await data.storage.listBuckets();

      final upload = requests[0];
      expect(upload.method, 'PUT');
      expect(
        upload.url.toString(),
        'https://sdk.example.test/v1/data/storage/object/avatars/user%201/photo.png',
      );
      expect(upload.headers['Content-Type'], 'image/png');
      expect(upload.headers['x-upsert'], 'true');
      expect(upload.bodyBytes, [9, 8, 7]);
      expect(stored.path, 'user 1/photo.png');
      expect(stored.size, 3);
      expect(
        requests[1].url.path,
        '/v1/data/storage/object/avatars/user%201/photo.png',
      );
      expect(requests[1].url.queryParameters, {
        'width': '128',
        'fit': 'scale-down',
        'format': 'webp',
      });
      expect(bytes, [1, 2, 3]);
      expect(requests[2].url.path, '/v1/data/storage/list/avatars');
      expect(requests[2].url.queryParameters, {
        'prefix': 'user 1/',
        'limit': '10',
      });
      expect(page.items.single.contentType, 'image/png');
      expect(page.nextCursor, 'user 1/photo.png');
      expect(
        requests[3].url.path,
        '/v1/data/storage/sign/avatars/user%201/photo.png',
      );
      expect(jsonDecode(requests[3].body), {
        'expires_in': 600,
        'transform': {'width': '128', 'fit': 'scale-down', 'format': 'webp'},
      });
      expect(signed.url.path, '/v1/data/storage/signed/tok');
      expect(signed.expiresAt, DateTime.utc(2026, 11, 7, 13));
      expect(requests[4].method, 'DELETE');
      expect(removed.etag, 'etag-1');
      expect(buckets.single.isPublic, isTrue);
      expect(buckets.single.allowedTypes, ['image/png']);
      expect(
        avatars.publicUrl(12, 'user 1/photo.png').toString(),
        'https://sdk.example.test/v1/data/storage/public/12/avatars/user%201/photo.png',
      );
    });

    test('sends a large upload in parts with progress', () async {
      final source = _pattern(11 * _mebibyte);
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        if (request.url.path == '/v1/data/storage/uploads/videos') {
          return _json({
            'upload_id': 'up-1',
            'path': 'clip.mp4',
            'minimum_part_size': 5 * _mebibyte,
            'expires_at': '2026-11-08T12:00:00.000Z',
          }, 201);
        }
        if (request.url.path.endsWith('/complete')) {
          return _json(_object('clip.mp4', size: source.length), 201);
        }
        return _json({
          'part_number': int.parse(request.url.pathSegments.last),
          'etag': 'e',
          'size': request.bodyBytes.length,
        });
      });
      final created = <String>[];
      final progress = <int>[];

      final stored = await data.storage
          .from('videos')
          .uploadResumable(
            'clip.mp4',
            SuperBoardUploadSource.bytes(source),
            contentType: 'video/mp4',
            partSize: 5 * _mebibyte,
            onUploadCreated: created.add,
            onProgress: (sent, total) {
              expect(total, source.length);
              progress.add(sent);
            },
          );

      expect(jsonDecode(requests.first.body), {
        'path': 'clip.mp4',
        'content_type': 'video/mp4',
        'upsert': false,
      });
      final parts = requests.where((request) => request.method == 'PUT');
      expect(parts.map((request) => request.url.path), [
        '/v1/data/storage/uploads/videos/up-1/1',
        '/v1/data/storage/uploads/videos/up-1/2',
        '/v1/data/storage/uploads/videos/up-1/3',
      ]);
      expect(parts.map((request) => request.bodyBytes.length), [
        5 * _mebibyte,
        5 * _mebibyte,
        _mebibyte,
      ]);
      expect(parts.elementAt(1).bodyBytes.first, source[5 * _mebibyte]);
      expect(
        requests.last.url.path,
        '/v1/data/storage/uploads/videos/up-1/complete',
      );
      expect(created, ['up-1']);
      expect(progress, [0, 5 * _mebibyte, 10 * _mebibyte, 11 * _mebibyte]);
      expect(stored.size, source.length);
    });

    test('resumes an upload from the parts the server received', () async {
      final source = _pattern(11 * _mebibyte);
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        if (request.method == 'GET') {
          return _json({
            'upload_id': 'up-9',
            'path': 'clip.mp4',
            'expires_at': '2026-11-08T12:00:00.000Z',
            'parts': [
              {'part_number': 1, 'etag': 'e1', 'size': 5 * _mebibyte},
              {'part_number': 2, 'etag': 'e2', 'size': 1234},
            ],
          });
        }
        if (request.url.path.endsWith('/complete')) {
          return _json(_object('clip.mp4', size: source.length), 201);
        }
        return _json({'part_number': 0, 'etag': 'e', 'size': 0});
      });
      final progress = <int>[];
      final created = <String>[];

      await data.storage
          .from('videos')
          .uploadResumable(
            'clip.mp4',
            SuperBoardUploadSource.bytes(source),
            resumeUploadId: 'up-9',
            onUploadCreated: created.add,
            onProgress: (sent, _) => progress.add(sent),
          );

      expect(
        requests.map((request) => '${request.method} ${request.url.path}'),
        [
          'GET /v1/data/storage/uploads/videos/up-9',
          'PUT /v1/data/storage/uploads/videos/up-9/2',
          'PUT /v1/data/storage/uploads/videos/up-9/3',
          'POST /v1/data/storage/uploads/videos/up-9/complete',
        ],
      );
      expect(requests[1].bodyBytes.length, 5 * _mebibyte);
      expect(requests[1].bodyBytes.first, source[5 * _mebibyte]);
      expect(requests[2].bodyBytes.length, _mebibyte);
      expect(progress, [5 * _mebibyte, 10 * _mebibyte, 11 * _mebibyte]);
      expect(created, isEmpty);
    });

    test('refuses to resume an upload of another path', () async {
      final data = _client(
        (_) async => _json({
          'upload_id': 'up-9',
          'path': 'other.mp4',
          'parts': <Object?>[],
        }),
      );

      await expectLater(
        data.storage
            .from('videos')
            .uploadResumable(
              'clip.mp4',
              SuperBoardUploadSource.bytes(_pattern(16)),
              resumeUploadId: 'up-9',
            ),
        throwsArgumentError,
      );
    });
  });

  group('functions and vectors', () {
    test('invokes a function and keeps the response of a failure', () async {
      final requests = <http.Request>[];
      final data = _client((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/fail')) {
          return _json({'message': 'bad input'}, 422);
        }
        return http.Response('pong', 200);
      }, accessToken: 'app-token');

      final response = await data.functions.invoke(
        'billing-hooks',
        path: '/events/42',
        query: {'dry': '1'},
        body: {'amount': 5},
        headers: {'X-Custom': 'yes', 'PROJECT-KEY': 'spoofed'},
      );
      final failure = data.functions.invoke(
        'billing-hooks',
        method: 'get',
        path: 'fail',
      );

      final request = requests.first;
      expect(request.method, 'POST');
      expect(request.url.path, '/v1/data/functions/billing-hooks/events/42');
      expect(request.url.queryParameters, {'dry': '1'});
      expect(jsonDecode(request.body), {'amount': 5});
      expect(request.headers['X-Custom'], 'yes');
      expect(request.headers['PROJECT-KEY'], 'og_app_key');
      expect(request.headers['Authorization'], 'Bearer app-token');
      expect(response.text, 'pong');
      await expectLater(
        failure,
        throwsA(
          isA<SuperBoardFunctionException>()
              .having((error) => error.statusCode, 'statusCode', 422)
              .having((error) => error.response.json(), 'body', {
                'message': 'bad input',
              }),
        ),
      );
      expect(requests.last.method, 'GET');
    });

    test(
      'indexes, queries and removes vectors and creates embeddings',
      () async {
        final requests = <http.Request>[];
        final data = _client((request) async {
          requests.add(request);
          final path = request.url.path;
          if (path.endsWith('/upsert')) {
            return _json({
              'items': [
                {'id': 'doc-1'},
              ],
            });
          }
          if (path.endsWith('/query')) {
            return _json({
              'items': [
                {
                  'id': 'doc-1',
                  'score': 0.92,
                  'content': 'Hello',
                  'metadata': {'lang': 'en'},
                  'owner_id': 'user-1',
                },
              ],
            });
          }
          if (path.endsWith('/embeddings')) {
            return _json({
              'model': '@cf/baai/bge-m3',
              'dimensions': 2,
              'data': [
                {
                  'index': 1,
                  'embedding': [0.3, 0.4],
                },
                {
                  'index': 0,
                  'embedding': [0.1, 0.2],
                },
              ],
            });
          }
          return _json({'deleted': true});
        }, accessToken: 'app-token');
        final docs = data.vectors.from('docs');

        final ids = await docs.upsert([
          const SuperBoardVectorItem(
            id: 'doc-1',
            text: 'Hello',
            metadata: {'lang': 'en'},
          ),
        ]);
        final matches = await docs.query(
          text: 'Hi',
          topK: 3,
          filter: {'lang': 'en'},
        );
        await docs.remove('doc-1');
        final embeddings = await data.ai.embeddings(['first', 'second']);

        expect(
          requests.map((request) => '${request.method} ${request.url.path}'),
          [
            'POST /v1/data/vectors/docs/upsert',
            'POST /v1/data/vectors/docs/query',
            'DELETE /v1/data/vectors/docs/doc-1',
            'POST /v1/data/ai/embeddings',
          ],
        );
        expect(jsonDecode(requests[0].body), {
          'items': [
            {
              'id': 'doc-1',
              'text': 'Hello',
              'metadata': {'lang': 'en'},
            },
          ],
        });
        expect(jsonDecode(requests[1].body), {
          'text': 'Hi',
          'top_k': 3,
          'filter': {'lang': 'en'},
        });
        expect(jsonDecode(requests[3].body), {
          'input': ['first', 'second'],
        });
        expect(ids, ['doc-1']);
        expect(matches.single.score, 0.92);
        expect(matches.single.metadata, {'lang': 'en'});
        expect(embeddings.embeddings, [
          [0.1, 0.2],
          [0.3, 0.4],
        ]);
      },
    );
  });
}

SuperBoardData _client(
  MockClientHandler handler, {
  String? accessToken,
  SuperBoardDataAccessTokenProvider? accessTokenProvider,
}) => SuperBoardData(
  baseUrl: 'https://sdk.example.test/v1/data/',
  projectKey: 'og_app_key',
  platformIdentifier: 'com.example.app',
  platform: 'ios',
  accessToken: accessToken,
  accessTokenProvider: accessTokenProvider,
  httpClient: MockClient(handler),
);

http.Response _json(
  Object body, [
  int status = 200,
  Map<String, String> headers = const {},
]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json', ...headers},
);

Map<String, Object?> _object(String path, {int size = 3}) => {
  'bucket': 'avatars',
  'path': path,
  'owner_id': 'user-1',
  'content_type': 'image/png',
  'size': size,
  'etag': 'etag-1',
  'created_at': '2026-11-07T12:00:00.000Z',
  'updated_at': '2026-11-07T12:00:00.000Z',
};

Uint8List _pattern(int length) {
  final bytes = Uint8List(length);
  for (var start = 0; start < length; start += _mebibyte) {
    final end = start + _mebibyte < length ? start + _mebibyte : length;
    bytes.fillRange(start, end, start ~/ _mebibyte + 1);
  }
  return bytes;
}

Matcher _code(String code) =>
    isA<SuperBoardDataException>().having((error) => error.code, 'code', code);
