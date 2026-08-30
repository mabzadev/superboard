import 'dart:async';
import 'dart:convert';
import 'dart:ui' show PlatformDispatcher;

import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models.dart';
import 'navigation.dart';
import 'storage.dart';

typedef SuperBoardFlowWebSocketConnector = WebSocketChannel Function(Uri uri);

class SuperBoardFlowsClient {
  SuperBoardFlowsClient({
    required String apiUrl,
    required String projectId,
    required String environment,
    required String userId,
    String? sdkKey,
    String? language,
    Map<String, dynamic> userProperties = const {},
    bool debug = false,
    bool realtime = true,
    http.Client? httpClient,
    SuperBoardFlowStorage? storage,
    SuperBoardFlowWebSocketConnector? webSocketConnector,
    SuperBoardFlowNavigationAdapter? navigationAdapter,
    List<Duration> reconnectDelays = const [
      Duration(milliseconds: 250),
      Duration(seconds: 1),
      Duration(seconds: 2),
      Duration(seconds: 5),
      Duration(seconds: 10),
    ],
  }) : _apiUrl = _normalizeApiUrl(apiUrl),
       _projectId = _requiredValue(projectId, 'projectId'),
       _environment = _requiredValue(environment, 'environment'),
       _userId = _requiredValue(userId, 'userId'),
       _sdkKey = _optionalCredential(sdkKey),
       _language = _normalizeLanguage(language),
       _userProperties = Map.unmodifiable(userProperties),
       _debug = debug,
       _realtime = realtime,
       _http = httpClient ?? http.Client(),
       _ownsHttp = httpClient == null,
       _storage = storage ?? SuperBoardSecureFlowStorage(),
       _webSocketConnector =
           webSocketConnector ?? ((uri) => WebSocketChannel.connect(uri)),
       _navigationAdapter = navigationAdapter,
       _reconnectDelays = List.unmodifiable(reconnectDelays);

  static const String sdkVersion = '3.0.0';

  final String _apiUrl;
  String _projectId;
  String _environment;
  String _userId;
  String? _sdkKey;
  String? _language;
  Map<String, dynamic> _userProperties;
  final bool _debug;
  final bool _realtime;
  final http.Client _http;
  final bool _ownsHttp;
  final SuperBoardFlowStorage _storage;
  final SuperBoardFlowWebSocketConnector _webSocketConnector;
  final SuperBoardFlowNavigationAdapter? _navigationAdapter;
  final List<Duration> _reconnectDelays;
  final Uuid _uuid = const Uuid();
  final StreamController<List<SuperBoardFlowBlock>> _blocksController =
      StreamController.broadcast(sync: true);
  final StreamController<String> _debugController = StreamController.broadcast(
    sync: true,
  );
  final Set<String> _activatedBlockStates = {};
  final Map<String, int> _tourProgress = {};
  final Set<String> _activeSurveyBlockStates = {};
  final List<SuperBoardFlowBlockUpdate> _pendingRealtimeUpdates = [];
  final List<SuperBoardFlowPendingCommand> _pendingCommands = [];

  List<SuperBoardFlowBlock> _blocks = const [];
  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _socketSubscription;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _disposed = false;
  bool _started = false;
  Future<void>? _connectOperation;
  Future<void> _persistTail = Future<void>.value();
  Future<void>? _commandFlushOperation;
  bool _refreshOnRealtimeConnect = false;
  bool _reconcilingRealtime = false;

  String get apiUrl => _apiUrl;
  String get projectId => _projectId;
  String get environment => _environment;
  String get userId => _userId;
  String? get language => _language;
  Map<String, dynamic> get userProperties => _userProperties;
  String get currentLocation =>
      _navigationAdapter?.currentLocation ??
      _userProperties['page']?.toString() ??
      'app://superboard/flows';
  bool get debug => _debug;
  List<SuperBoardFlowBlock> get blocks => List.unmodifiable(_blocks);
  List<SuperBoardFlowBlock> get floatingBlocks => List.unmodifiable(
    _blocks.where(
      (block) =>
          _renderPlacement(block).isFloating && _matchesPageTargeting(block),
    ),
  );
  Stream<List<SuperBoardFlowBlock>> get blocksStream =>
      _blocksController.stream;
  Stream<List<SuperBoardFlowBlock>> get floatingBlocksStream =>
      _blocksController.stream.map((_) => floatingBlocks);
  Stream<String> get debugStream => _debugController.stream;

  List<SuperBoardFlowBlock> slotBlocks(String slotId) {
    final result = _blocks
        .where((block) {
          final placement = _renderPlacement(block);
          return placement.slottable &&
              placement.slotId == slotId &&
              _matchesPageTargeting(block);
        })
        .toList(growable: false);
    result.sort(
      (left, right) => (_renderPlacement(left).slotIndex ?? 0).compareTo(
        _renderPlacement(right).slotIndex ?? 0,
      ),
    );
    return List.unmodifiable(result);
  }

  int tourIndex(SuperBoardFlowBlock block) =>
      _tourProgress[block.blockStateId ?? block.id] ??
      block.currentTourIndex ??
      0;

  bool surveyStarted(SuperBoardFlowBlock block) =>
      _activeSurveyBlockStates.contains(block.blockStateId ?? block.id);

  Future<void> markSurveyStarted(SuperBoardFlowBlock block) async {
    if (_activeSurveyBlockStates.add(block.blockStateId ?? block.id)) {
      await _persist();
    }
  }

  Stream<List<SuperBoardFlowBlock>> slotBlocksStream(String slotId) =>
      _blocksController.stream.map((_) => slotBlocks(slotId));

  SuperBoardFlowBlock _renderPlacement(SuperBoardFlowBlock block) {
    if (block.type != SuperBoardFlowBlockType.tour ||
        block.tourBlocks.isEmpty) {
      return block;
    }
    final index = tourIndex(block).clamp(0, block.tourBlocks.length - 1);
    return block.tourBlocks[index];
  }

  bool _matchesPageTargeting(SuperBoardFlowBlock block) {
    final placement = _renderPlacement(block);
    final operator = placement.pageTargetingOperator;
    final expected = placement.pageTargetingValues;
    if (operator == null || operator.isEmpty || expected.isEmpty) return true;
    final value = currentLocation;
    bool any(bool Function(String item) test) => expected.any(test);
    bool every(bool Function(String item) test) => expected.every(test);
    return switch (operator) {
      'eq' => any((item) => value == item),
      'ne' => every((item) => value != item),
      'contains' => any(value.contains),
      'notContains' => every((item) => !value.contains(item)),
      'startsWith' => any(value.startsWith),
      'endsWith' => any(value.endsWith),
      'notStartsWith' => every((item) => !value.startsWith(item)),
      'notEndsWith' => every((item) => !value.endsWith(item)),
      'regex' => any((item) {
        try {
          return RegExp(item).hasMatch(value);
        } on FormatException {
          return false;
        }
      }),
      _ => true,
    };
  }

  Future<void> start() async {
    _assertUsable();
    if (_started) return;
    _started = true;
    final persisted = await _storage.read();
    if (persisted != null && _matchesContext(persisted)) {
      _language ??= persisted.language;
      if (_userProperties.isEmpty && persisted.userProperties.isNotEmpty) {
        _userProperties = Map.unmodifiable(persisted.userProperties);
      }
      _tourProgress
        ..clear()
        ..addAll(persisted.tourProgress);
      _activeSurveyBlockStates
        ..clear()
        ..addAll(persisted.activeSurveyBlockStates);
      _pendingCommands
        ..clear()
        ..addAll(persisted.pendingCommands);
      _replaceBlocks(persisted.blocks, source: 'storage');
    }
    try {
      await _flushPendingCommands();
    } catch (error) {
      _log('Pending Flows commands remain queued: $error');
    }
    try {
      await refreshBlocks();
    } catch (error) {
      _log('Initial Flows refresh failed: $error');
      if (_blocks.isEmpty) {
        _started = false;
        rethrow;
      }
    }
    if (_realtime) await connectRealtime();
  }

  Future<SuperBoardFlowBlocksSnapshot> refreshBlocks() async {
    _assertUsable();
    final body = await _post('/v2/sdk/blocks', _contextBody(includeUser: true));
    final snapshot = SuperBoardFlowBlocksSnapshot.fromJson(body);
    _replaceBlocks(snapshot.blocks, source: 'http');
    await _persist();
    return snapshot;
  }

  Future<List<SuperBoardFlowWorkflow>> fetchWorkflows() async {
    final body = await _post('/v2/sdk/workflows', _contextBody());
    final workflows = body['workflows'];
    if (workflows is! List) return const [];
    return workflows
        .whereType<Map>()
        .map(
          (workflow) => SuperBoardFlowWorkflow.fromJson(
            workflow.map((key, value) => MapEntry(key.toString(), value)),
          ),
        )
        .toList(growable: false);
  }

  Future<void> identify(
    String value, {
    Map<String, dynamic>? properties,
  }) async {
    _assertUsable();
    final nextUserId = _requiredValue(value, 'userId');
    final changed = nextUserId != _userId;
    if (changed) await _flushPendingCommands();
    _userId = nextUserId;
    if (properties != null) {
      _userProperties = Map.unmodifiable(properties);
    }
    if (changed) {
      _activatedBlockStates.clear();
      _tourProgress.clear();
      _activeSurveyBlockStates.clear();
      _replaceBlocks(const [], source: 'identity');
      await _disconnectRealtime(scheduleReconnect: false);
    }
    await refreshBlocks();
    if (_realtime && changed) await connectRealtime();
  }

  Future<void> setUserProperties(
    Map<String, dynamic> properties, {
    bool merge = true,
  }) async {
    _userProperties = Map.unmodifiable(
      merge ? {..._userProperties, ...properties} : properties,
    );
    await refreshBlocks();
  }

  Future<void> setLanguage(String? value) async {
    _language = _normalizeLanguage(value);
    await refreshBlocks();
  }

  Future<void> setContext({
    required String projectId,
    required String environment,
    String? sdkKey,
    String? language,
  }) async {
    final nextProject = _requiredValue(projectId, 'projectId');
    final nextEnvironment = _requiredValue(environment, 'environment');
    final nextSdkKey = _optionalCredential(sdkKey);
    final changed =
        nextProject != _projectId ||
        nextEnvironment != _environment ||
        nextSdkKey != _sdkKey;
    if (changed) await _flushPendingCommands();
    _projectId = nextProject;
    _environment = nextEnvironment;
    _sdkKey = nextSdkKey;
    _language = _normalizeLanguage(language);
    if (changed) {
      _activatedBlockStates.clear();
      _tourProgress.clear();
      _activeSurveyBlockStates.clear();
      _replaceBlocks(const [], source: 'context');
      await _disconnectRealtime(scheduleReconnect: false);
    }
    await refreshBlocks();
    if (_realtime && changed) await connectRealtime();
  }

  Future<void> startWorkflow(String blockKey) => _sendEvent(
    SuperBoardFlowEventName.workflowStart,
    blockKey: _requiredValue(blockKey, 'blockKey'),
  );

  Future<void> resetWorkflowProgress(String workflowId) => _sendEvent(
    SuperBoardFlowEventName.resetProgress,
    workflowId: _requiredValue(workflowId, 'workflowId'),
  );

  Future<void> resetAllWorkflowsProgress() =>
      _sendEvent(SuperBoardFlowEventName.resetProgress);

  Future<void> transition(
    SuperBoardFlowBlock block, {
    String exitNode = 'default',
    Map<String, dynamic> properties = const {},
  }) => _sendEvent(
    SuperBoardFlowEventName.transition,
    workflowId: block.workflowId,
    blockId: block.id,
    blockStateId: block.blockStateId,
    propertyKey: exitNode,
    properties: {'exitNode': exitNode, ...properties},
  );

  Future<void> updateTour(
    SuperBoardFlowBlock block, {
    required int index,
    String? action,
  }) async {
    await _sendEvent(
      SuperBoardFlowEventName.tourUpdate,
      workflowId: block.workflowId,
      blockId: block.id,
      blockStateId: block.blockStateId,
      // Keep the exact upstream SDK contract. The Worker validates this key
      // before applying the tour transition.
      properties: {
        'currentTourIndex': index,
        if (action != null) 'action': action,
      },
    );
    _tourProgress[block.blockStateId ?? block.id] = index;
    _blocksController.add(_blocks);
    await _persist();
  }

  Future<void> setStateMemory(
    SuperBoardFlowBlock block,
    String propertyKey,
    Object? value,
  ) => _sendEvent(
    SuperBoardFlowEventName.setStateMemory,
    workflowId: block.workflowId,
    blockId: block.id,
    blockStateId: block.blockStateId,
    propertyKey: propertyKey,
    properties: {'value': value},
  );

  Future<void> activateBlock(SuperBoardFlowBlock block) async {
    final state = block.blockStateId ?? block.id;
    if (!_activatedBlockStates.add(state)) return;
    try {
      await _sendEvent(
        SuperBoardFlowEventName.blockActivated,
        workflowId: block.workflowId,
        blockId: block.id,
        blockStateId: block.blockStateId,
      );
    } catch (_) {
      _activatedBlockStates.remove(state);
      rethrow;
    }
  }

  Future<void> submitSurvey(
    SuperBoardFlowBlock block,
    List<SuperBoardFlowSurveyAnswer> answers, {
    String? location,
  }) async {
    final survey = block.survey;
    if (survey == null || survey.blockStateId.isEmpty) {
      throw const SuperBoardFlowException(
        'The block does not contain an active survey',
        code: 'flows_survey_missing',
      );
    }
    final blockStateId = survey.blockStateId;
    await _enqueueCommand(
      '/v2/sdk/survey',
      {
        ..._contextBody(),
        'surveyId': survey.id,
        'blockStateId': blockStateId,
        'workflowId': block.workflowId,
        'blockId': block.id,
        'url':
            location ??
            _navigationAdapter?.currentLocation ??
            'app://superboard/flows',
        'questions': answers.map((answer) => answer.toJson()).toList(),
      },
      idempotencyKey: 'survey:$blockStateId',
      followUp: {
        'path': '/v2/sdk/events',
        'body': _eventBody(
          SuperBoardFlowEventName.transition,
          workflowId: block.workflowId,
          blockId: block.id,
          blockStateId: blockStateId,
          propertyKey: 'submit',
          properties: const {'exitNode': 'submit'},
        ),
      },
    );
    _activeSurveyBlockStates.remove(block.blockStateId ?? block.id);
    await _persist();
  }

  Future<void> notifyNavigation(String location) async {
    _userProperties = Map.unmodifiable({..._userProperties, 'page': location});
    await refreshBlocks();
  }

  Future<void> navigate(String location) async {
    final adapter = _navigationAdapter;
    if (adapter == null) {
      throw const SuperBoardFlowException(
        'No navigation adapter was configured',
        code: 'flows_navigation_unavailable',
      );
    }
    await adapter.navigate(location);
    await notifyNavigation(adapter.currentLocation);
  }

  Future<void> connectRealtime() {
    _assertUsable();
    if (!_realtime || _channel != null) return Future.value();
    final running = _connectOperation;
    if (running != null) return running;
    final operation = _openRealtime();
    _connectOperation = operation;
    return operation.whenComplete(() => _connectOperation = null);
  }

  Future<void> _openRealtime() async {
    _reconnectTimer?.cancel();
    final uri = _webSocketUri();
    // Never place the WebSocket credential in debug output.
    _log('Connecting realtime: ${uri.path}');
    try {
      final channel = _webSocketConnector(uri);
      _channel = channel;
      _socketSubscription = channel.stream.listen(
        _handleSocketMessage,
        onError: (Object error, StackTrace stackTrace) {
          _log('Realtime error: $error');
          unawaited(_disconnectRealtime(scheduleReconnect: true));
        },
        onDone: () {
          _log('Realtime disconnected');
          unawaited(_disconnectRealtime(scheduleReconnect: true));
        },
        cancelOnError: true,
      );
      await channel.ready;
      if (!identical(_channel, channel)) return;
      _reconnectAttempt = 0;
      try {
        await _flushPendingCommands();
      } catch (error) {
        _log('Pending Flows commands remain queued after reconnect: $error');
      }
      if (_refreshOnRealtimeConnect) {
        _refreshOnRealtimeConnect = false;
        await _reconcileAfterRealtimeReconnect();
      }
    } catch (error) {
      _log('Realtime connection failed: $error');
      await _disconnectRealtime(scheduleReconnect: true);
    }
  }

  void _handleSocketMessage(Object? raw) {
    try {
      final decoded = raw is String ? jsonDecode(raw) : raw;
      if (decoded is! Map) throw const FormatException('Expected an object');
      final update = SuperBoardFlowBlockUpdate.fromJson(
        decoded.map((key, value) => MapEntry(key.toString(), value)),
      );
      if (_reconcilingRealtime) {
        _pendingRealtimeUpdates.add(update);
        return;
      }
      _applyUpdate(update, source: 'websocket');
      unawaited(_persist());
    } catch (error) {
      _log('Ignored invalid realtime message: $error');
    }
  }

  Future<void> _sendEvent(
    SuperBoardFlowEventName name, {
    String? workflowId,
    String? blockId,
    String? blockStateId,
    String? blockKey,
    String? propertyKey,
    Map<String, dynamic>? properties,
  }) => _enqueueCommand(
    '/v2/sdk/events',
    _eventBody(
      name,
      workflowId: workflowId,
      blockId: blockId,
      blockStateId: blockStateId,
      blockKey: blockKey,
      propertyKey: propertyKey,
      properties: properties,
    ),
  );

  Map<String, dynamic> _eventBody(
    SuperBoardFlowEventName name, {
    String? workflowId,
    String? blockId,
    String? blockStateId,
    String? blockKey,
    String? propertyKey,
    Map<String, dynamic>? properties,
  }) => {
    ..._contextBody(),
    'name': name.wireName,
    if (workflowId != null) 'workflowId': workflowId,
    if (blockId != null) 'blockId': blockId,
    if (blockStateId != null) 'blockStateId': blockStateId,
    if (blockKey != null) 'blockKey': blockKey,
    if (propertyKey != null) 'propertyKey': propertyKey,
    if (properties != null) 'properties': properties,
    if (_language != null) 'locale': _language,
  };

  Future<void> _enqueueCommand(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
    Map<String, dynamic>? followUp,
  }) async {
    final fingerprint = _commandFingerprint(path, body, followUp);
    final alreadyQueued = _pendingCommands.any(
      (command) =>
          (idempotencyKey != null && command.id == idempotencyKey) ||
          _commandFingerprint(
                command.path,
                _withoutEventId(command.body),
                command.followUp,
              ) ==
              fingerprint,
    );
    if (!alreadyQueued) {
      final eventId = idempotencyKey ?? _uuid.v4();
      _pendingCommands.add(
        SuperBoardFlowPendingCommand(
          id: eventId,
          path: path,
          body: {...body, 'eventId': eventId},
          followUp: followUp,
        ),
      );
      await _persist();
    }
    await _flushPendingCommands();
  }

  Future<void> _flushPendingCommands() async {
    final running = _commandFlushOperation;
    if (running != null) {
      await running;
      if (_pendingCommands.isNotEmpty) await _flushPendingCommands();
      return;
    }
    final operation = _drainPendingCommands();
    _commandFlushOperation = operation;
    try {
      await operation;
    } finally {
      if (identical(_commandFlushOperation, operation)) {
        _commandFlushOperation = null;
      }
    }
  }

  Future<void> _drainPendingCommands() async {
    while (_pendingCommands.isNotEmpty) {
      final command = _pendingCommands.first;
      final response = await _post(
        command.path,
        command.body,
        idempotencyKey: command.id,
      );
      if (response.containsKey('updatedBlocks') ||
          response.containsKey('exitedBlockIds')) {
        _applyUpdate(
          SuperBoardFlowBlockUpdate.fromJson(response),
          source: 'event',
        );
      }
      if (_pendingCommands.isNotEmpty &&
          _pendingCommands.first.id == command.id) {
        _pendingCommands.removeAt(0);
      } else {
        _pendingCommands.removeWhere((item) => item.id == command.id);
      }
      final followUp = command.followUp;
      final followUpPath = followUp?['path']?.toString();
      final followUpBodyValue = followUp?['body'];
      if (followUpPath != null && followUpBodyValue is Map) {
        final followUpBody = followUpBodyValue.map(
          (key, value) => MapEntry(key.toString(), value),
        );
        final eventId = _uuid.v4();
        _pendingCommands.insert(
          0,
          SuperBoardFlowPendingCommand(
            id: eventId,
            path: followUpPath,
            body: {...followUpBody, 'eventId': eventId},
          ),
        );
      }
      await _persist();
    }
  }

  Map<String, dynamic> _withoutEventId(Map<String, dynamic> body) =>
      Map<String, dynamic>.of(body)..remove('eventId');

  String _commandFingerprint(
    String path,
    Map<String, dynamic> body,
    Map<String, dynamic>? followUp,
  ) => jsonEncode([path, body, followUp]);

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) async {
    _assertUsable();
    final uri = _uri(path);
    _log('POST ${uri.path}');
    http.Response response;
    try {
      response = await _http
          .post(
            uri,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-flows-version': 'superboard-flutter@$sdkVersion',
              if (_sdkKey != null) 'x-superboard-flows-sdk-key': _sdkKey!,
              if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw const SuperBoardFlowException(
        'The Flows request timed out',
        code: 'flows_timeout',
        retryable: true,
      );
    } on http.ClientException catch (error) {
      throw SuperBoardFlowException(
        'Flows is unavailable: ${error.message}',
        code: 'flows_network_unavailable',
        retryable: true,
      );
    }
    Map<String, dynamic> decoded;
    try {
      final value = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      if (value is! Map) throw const FormatException('Expected an object');
      decoded = value.map((key, item) => MapEntry(key.toString(), item));
    } on FormatException {
      throw SuperBoardFlowException(
        'Flows returned an invalid response',
        code: 'flows_response_invalid',
        statusCode: response.statusCode,
        retryable: response.statusCode >= 500,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded['error'] is Map
          ? (decoded['error'] as Map).map(
              (key, value) => MapEntry(key.toString(), value),
            )
          : <String, dynamic>{};
      throw SuperBoardFlowException(
        error['message']?.toString() ??
            decoded['message']?.toString() ??
            'The Flows request failed',
        code: error['code']?.toString() ?? 'flows_request_failed',
        statusCode: response.statusCode,
        retryable: error['retryable'] == true || response.statusCode >= 500,
        requestId:
            error['request_id']?.toString() ?? response.headers['x-request-id'],
      );
    }
    final data = decoded['data'];
    return data is Map
        ? data.map((key, value) => MapEntry(key.toString(), value))
        : decoded;
  }

  Map<String, dynamic> _contextBody({bool includeUser = false}) => {
    'projectId': _projectId,
    'environment': _environment,
    'userId': _userId,
    if (includeUser) 'userProperties': _userProperties,
    if (includeUser && _language != null) 'language': _language,
  };

  void _replaceBlocks(
    Iterable<SuperBoardFlowBlock> value, {
    required String source,
  }) {
    final unique = <String, SuperBoardFlowBlock>{};
    for (final block in value) {
      unique[block.blockStateId ?? block.id] = block;
    }
    _blocks = List.unmodifiable(unique.values);
    final liveSurveyStates = unique.values
        .where((block) => block.type == SuperBoardFlowBlockType.survey)
        .map((block) => block.blockStateId ?? block.id)
        .toSet();
    _activeSurveyBlockStates.retainAll(liveSurveyStates);
    _blocksController.add(_blocks);
    _log('Blocks updated from $source (${_blocks.length})');
  }

  void _applyUpdate(
    SuperBoardFlowBlockUpdate update, {
    required String source,
  }) {
    final exited = update.exitedBlockIds.toSet();
    for (final block in _blocks) {
      if (exited.contains(block.id) || exited.contains(block.blockStateId)) {
        _tourProgress.remove(block.blockStateId ?? block.id);
        _activeSurveyBlockStates.remove(block.blockStateId ?? block.id);
      }
    }
    final values = <String, SuperBoardFlowBlock>{
      for (final block in _blocks)
        if (!exited.contains(block.id) && !exited.contains(block.blockStateId))
          block.blockStateId ?? block.id: block,
    };
    for (final block in update.updatedBlocks) {
      values[block.blockStateId ?? block.id] = block;
    }
    _replaceBlocks(values.values, source: source);
  }

  bool _matchesContext(SuperBoardFlowPersistedState value) =>
      value.projectId == _projectId &&
      value.environment == _environment &&
      value.userId == _userId;

  Future<void> _persist() {
    final snapshot = SuperBoardFlowPersistedState(
      projectId: _projectId,
      environment: _environment,
      userId: _userId,
      language: _language,
      userProperties: _userProperties,
      blocks: _blocks,
      tourProgress: Map.unmodifiable(_tourProgress),
      activeSurveyBlockStates: List.unmodifiable(_activeSurveyBlockStates),
      pendingCommands: List.unmodifiable(_pendingCommands),
    );
    final operation = _persistTail.then((_) => _storage.write(snapshot));
    _persistTail = operation.catchError((Object _) {});
    return operation;
  }

  Uri _uri(String path) => Uri.parse(
    '${_apiUrl.replaceFirst(RegExp(r'/+$'), '')}/${path.replaceFirst(RegExp(r'^/+'), '')}',
  );

  Uri _webSocketUri() {
    final uri = _uri('/ws/sdk/block-updates');
    final scheme = switch (uri.scheme) {
      'https' => 'wss',
      'http' => 'ws',
      'wss' || 'ws' => uri.scheme,
      _ => throw const SuperBoardFlowException(
        'Flows apiUrl must use HTTP or HTTPS',
        code: 'flows_api_url_invalid',
      ),
    };
    return uri.replace(
      scheme: scheme,
      queryParameters: {
        'projectId': _projectId,
        'environment': _environment,
        'userId': _userId,
        if (_sdkKey != null) 'sdkKey': _sdkKey!,
      },
    );
  }

  Future<void> _disconnectRealtime({required bool scheduleReconnect}) async {
    final subscription = _socketSubscription;
    final channel = _channel;
    _socketSubscription = null;
    _channel = null;
    await subscription?.cancel();
    await channel?.sink.close();
    if (scheduleReconnect) {
      _refreshOnRealtimeConnect = true;
      _scheduleReconnect();
    }
  }

  Future<void> _reconcileAfterRealtimeReconnect() async {
    _reconcilingRealtime = true;
    try {
      await refreshBlocks();
    } catch (error) {
      _log('Realtime reconciliation failed: $error');
    } finally {
      _reconcilingRealtime = false;
      final pending = List<SuperBoardFlowBlockUpdate>.of(
        _pendingRealtimeUpdates,
      );
      _pendingRealtimeUpdates.clear();
      for (final update in pending) {
        _applyUpdate(update, source: 'websocket-reconnect');
      }
      if (pending.isNotEmpty) await _persist();
    }
  }

  void _scheduleReconnect() {
    if (_disposed || !_realtime || _reconnectTimer?.isActive == true) return;
    final delay = _reconnectDelays.isEmpty
        ? const Duration(seconds: 1)
        : _reconnectDelays[_reconnectAttempt.clamp(
            0,
            _reconnectDelays.length - 1,
          )];
    _reconnectAttempt += 1;
    _reconnectTimer = Timer(delay, () => unawaited(connectRealtime()));
  }

  void _log(String message) {
    if (!_debug || _debugController.isClosed) return;
    _debugController.add(
      '${DateTime.now().toUtc().toIso8601String()} $message',
    );
  }

  void _assertUsable() {
    if (_disposed) {
      throw const SuperBoardFlowException(
        'The Flows client has been disposed',
        code: 'flows_client_disposed',
      );
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _reconnectTimer?.cancel();
    await _disconnectRealtime(scheduleReconnect: false);
    await _persistTail;
    if (_ownsHttp) _http.close();
    await _blocksController.close();
    await _debugController.close();
  }
}

abstract final class SuperBoardFlows {
  static SuperBoardFlowsClient? _client;

  static SuperBoardFlowsClient get instance {
    final value = _client;
    if (value == null) {
      throw const SuperBoardFlowException(
        'Call SuperBoardFlows.initialize before using Flows',
        code: 'flows_not_initialized',
      );
    }
    return value;
  }

  static SuperBoardFlowsClient? get instanceOrNull => _client;

  static Future<SuperBoardFlowsClient> initialize({
    required String apiUrl,
    required String projectId,
    required String environment,
    required String userId,
    String? sdkKey,
    String? language,
    Map<String, dynamic> userProperties = const {},
    bool debug = false,
    bool realtime = true,
    http.Client? httpClient,
    SuperBoardFlowStorage? storage,
    SuperBoardFlowWebSocketConnector? webSocketConnector,
    SuperBoardFlowNavigationAdapter? navigationAdapter,
  }) async {
    await _client?.dispose();
    final client = SuperBoardFlowsClient(
      apiUrl: apiUrl,
      projectId: projectId,
      environment: environment,
      userId: userId,
      sdkKey: sdkKey,
      language: language,
      userProperties: userProperties,
      debug: debug,
      realtime: realtime,
      httpClient: httpClient,
      storage: storage,
      webSocketConnector: webSocketConnector,
      navigationAdapter: navigationAdapter,
    );
    _client = client;
    try {
      await client.start();
      return client;
    } catch (_) {
      if (identical(_client, client)) _client = null;
      await client.dispose();
      rethrow;
    }
  }

  static Future<void> identify(
    String userId, {
    Map<String, dynamic>? properties,
  }) => instance.identify(userId, properties: properties);

  static Future<void> setUserProperties(
    Map<String, dynamic> properties, {
    bool merge = true,
  }) => instance.setUserProperties(properties, merge: merge);

  static Future<void> setLanguage(String? language) =>
      instance.setLanguage(language);

  static Future<void> startWorkflow(String blockKey) =>
      instance.startWorkflow(blockKey);

  static Future<void> resetWorkflowProgress(String workflowId) =>
      instance.resetWorkflowProgress(workflowId);

  static Future<void> resetAllWorkflowsProgress() =>
      instance.resetAllWorkflowsProgress();

  static Future<List<SuperBoardFlowWorkflow>> fetchWorkflows() =>
      instance.fetchWorkflows();

  static Future<void> dispose() async {
    final value = _client;
    _client = null;
    await value?.dispose();
  }
}

String _normalizeApiUrl(String value) {
  final normalized = _requiredValue(
    value,
    'apiUrl',
  ).replaceFirst(RegExp(r'/+$'), '');
  final uri = Uri.tryParse(normalized);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    throw const SuperBoardFlowException(
      'Flows apiUrl must be an absolute HTTP or HTTPS URL',
      code: 'flows_api_url_invalid',
    );
  }
  return normalized;
}

String _requiredValue(String value, String name) {
  final result = value.trim();
  if (result.isEmpty) {
    throw SuperBoardFlowException(
      '$name must not be empty',
      code: 'flows_configuration_invalid',
    );
  }
  return result;
}

String? _normalizeLanguage(String? value) {
  final result = value?.trim();
  if (result == null || result.isEmpty || result == 'disabled') return null;
  if (result == 'automatic') {
    return PlatformDispatcher.instance.locale.toLanguageTag();
  }
  return result;
}

String? _optionalCredential(String? value) {
  final normalized = value?.trim();
  return normalized == null || normalized.isEmpty ? null : normalized;
}
