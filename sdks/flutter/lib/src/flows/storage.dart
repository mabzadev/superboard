import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

class SuperBoardFlowPendingCommand {
  const SuperBoardFlowPendingCommand({
    required this.id,
    required this.path,
    required this.body,
    this.followUp,
  });

  final String id;
  final String path;
  final Map<String, dynamic> body;
  final Map<String, dynamic>? followUp;

  Map<String, dynamic> toJson() => {
    'id': id,
    'path': path,
    'body': body,
    if (followUp != null) 'followUp': followUp,
  };

  factory SuperBoardFlowPendingCommand.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowPendingCommand(
        id: json['id']?.toString() ?? '',
        path: json['path']?.toString() ?? '',
        body: json['body'] is Map
            ? (json['body'] as Map).map(
                (key, value) => MapEntry(key.toString(), value),
              )
            : <String, dynamic>{},
        followUp: json['followUp'] is Map
            ? (json['followUp'] as Map).map(
                (key, value) => MapEntry(key.toString(), value),
              )
            : null,
      );
}

class SuperBoardFlowPersistedState {
  const SuperBoardFlowPersistedState({
    required this.projectId,
    required this.environment,
    required this.userId,
    required this.language,
    required this.userProperties,
    required this.blocks,
    this.tourProgress = const {},
    this.activeSurveyBlockStates = const [],
    this.pendingCommands = const [],
  });

  final String projectId;
  final String environment;
  final String userId;
  final String? language;
  final Map<String, dynamic> userProperties;
  final List<SuperBoardFlowBlock> blocks;
  final Map<String, int> tourProgress;
  final List<String> activeSurveyBlockStates;
  final List<SuperBoardFlowPendingCommand> pendingCommands;

  Map<String, dynamic> toJson() => {
    'projectId': projectId,
    'environment': environment,
    'userId': userId,
    if (language != null) 'language': language,
    'userProperties': userProperties,
    'blocks': blocks.map((block) => block.toJson()).toList(growable: false),
    'tourProgress': tourProgress,
    'activeSurveyBlockStates': activeSurveyBlockStates,
    'pendingCommands': pendingCommands
        .map((command) => command.toJson())
        .toList(growable: false),
  };

  factory SuperBoardFlowPersistedState.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowPersistedState(
        projectId: json['projectId']?.toString() ?? '',
        environment: json['environment']?.toString() ?? '',
        userId: json['userId']?.toString() ?? '',
        language: json['language']?.toString(),
        userProperties: json['userProperties'] is Map
            ? (json['userProperties'] as Map).map(
                (key, value) => MapEntry(key.toString(), value),
              )
            : <String, dynamic>{},
        blocks: json['blocks'] is List
            ? (json['blocks'] as List)
                  .whereType<Map>()
                  .map(
                    (value) => SuperBoardFlowBlock.fromJson(
                      value.map((key, item) => MapEntry(key.toString(), item)),
                    ),
                  )
                  .toList(growable: false)
            : const [],
        tourProgress: json['tourProgress'] is Map
            ? (json['tourProgress'] as Map).map(
                (key, value) =>
                    MapEntry(key.toString(), value is num ? value.toInt() : 0),
              )
            : const {},
        activeSurveyBlockStates: json['activeSurveyBlockStates'] is List
            ? (json['activeSurveyBlockStates'] as List)
                  .map((value) => value.toString())
                  .where((value) => value.isNotEmpty)
                  .toList(growable: false)
            : const [],
        pendingCommands: json['pendingCommands'] is List
            ? (json['pendingCommands'] as List)
                  .whereType<Map>()
                  .map(
                    (value) => SuperBoardFlowPendingCommand.fromJson(
                      value.map((key, item) => MapEntry(key.toString(), item)),
                    ),
                  )
                  .where(
                    (command) =>
                        command.id.isNotEmpty && command.path.isNotEmpty,
                  )
                  .toList(growable: false)
            : const [],
      );
}

abstract interface class SuperBoardFlowStorage {
  Future<SuperBoardFlowPersistedState?> read();

  Future<void> write(SuperBoardFlowPersistedState state);

  Future<void> clear();
}

/// Encrypted device storage used by default by the Flows SDK.
class SuperBoardSecureFlowStorage implements SuperBoardFlowStorage {
  SuperBoardSecureFlowStorage({
    FlutterSecureStorage? secureStorage,
    this.storageKey = 'superboard_flows_state_v1',
  }) : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _secureStorage;
  final String storageKey;

  @override
  Future<SuperBoardFlowPersistedState?> read() async {
    final encoded = await _secureStorage.read(key: storageKey);
    if (encoded == null || encoded.isEmpty) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map) return null;
      return SuperBoardFlowPersistedState.fromJson(
        decoded.map((key, value) => MapEntry(key.toString(), value)),
      );
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(SuperBoardFlowPersistedState state) =>
      _secureStorage.write(key: storageKey, value: jsonEncode(state.toJson()));

  @override
  Future<void> clear() => _secureStorage.delete(key: storageKey);
}

class SuperBoardMemoryFlowStorage implements SuperBoardFlowStorage {
  SuperBoardFlowPersistedState? state;

  @override
  Future<void> clear() async => state = null;

  @override
  Future<SuperBoardFlowPersistedState?> read() async => state;

  @override
  Future<void> write(SuperBoardFlowPersistedState value) async => state = value;
}
