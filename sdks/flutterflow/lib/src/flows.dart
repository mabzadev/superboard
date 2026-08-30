import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:superboard_flutter/superboard_flows.dart';

Stream<String> get superboardFlowFloatingBlocksJsonStream => SuperBoardFlows
    .instance
    .floatingBlocksStream
    .map(superBoardFlowBlocksToJson);

Stream<String> superboardFlowSlotBlocksJsonStream(String slotId) =>
    SuperBoardFlows.instance
        .slotBlocksStream(slotId)
        .map(superBoardFlowBlocksToJson);

Future<bool> superboardFlowsInitialize({
  required String apiUrl,
  required String projectId,
  required String environment,
  required String userId,
  String sdkKey = '',
  String language = 'disabled',
  String userPropertiesJson = '{}',
  bool debug = false,
  bool realtime = true,
}) async {
  await SuperBoardFlows.initialize(
    apiUrl: apiUrl,
    projectId: projectId,
    environment: environment,
    userId: userId,
    sdkKey: sdkKey,
    language: language,
    userProperties: _decodeObject(userPropertiesJson, 'userPropertiesJson'),
    debug: debug,
    realtime: realtime,
  );
  return true;
}

Future<bool> superboardFlowsIdentify({
  required String userId,
  String userPropertiesJson = '{}',
}) async {
  await SuperBoardFlows.identify(
    userId,
    properties: _decodeObject(userPropertiesJson, 'userPropertiesJson'),
  );
  return true;
}

Future<bool> superboardFlowsSetUserPropertiesJson(
  String userPropertiesJson, {
  bool merge = true,
}) async {
  await SuperBoardFlows.setUserProperties(
    _decodeObject(userPropertiesJson, 'userPropertiesJson'),
    merge: merge,
  );
  return true;
}

Future<bool> superboardFlowsSetContext({
  required String projectId,
  required String environment,
  String sdkKey = '',
  String language = 'disabled',
}) async {
  await SuperBoardFlows.instance.setContext(
    projectId: projectId,
    environment: environment,
    sdkKey: sdkKey,
    language: language,
  );
  return true;
}

Future<bool> superboardFlowsSetLanguage(String language) async {
  await SuperBoardFlows.setLanguage(language);
  return true;
}

Future<bool> superboardFlowsStartWorkflow(String blockKey) async {
  await SuperBoardFlows.startWorkflow(blockKey);
  return true;
}

Future<bool> superboardFlowsResetWorkflowProgress(String workflowId) async {
  await SuperBoardFlows.resetWorkflowProgress(workflowId);
  return true;
}

Future<bool> superboardFlowsResetAllWorkflowsProgress() async {
  await SuperBoardFlows.resetAllWorkflowsProgress();
  return true;
}

Future<String> superboardFlowsFetchWorkflowsJson() async {
  final workflows = await SuperBoardFlows.fetchWorkflows();
  return jsonEncode({
    'workflows': [
      for (final workflow in workflows)
        {
          'id': workflow.id,
          'workflow_status':
              workflow.status == SuperBoardFlowWorkflowStatus.launchpadEnabled
              ? 'launchpad-enabled'
              : 'enabled',
          'frequency':
              workflow.frequency == SuperBoardFlowWorkflowFrequency.everyTime
              ? 'every-time'
              : 'once',
          'user_state': switch (workflow.userState) {
            SuperBoardFlowUserState.notStarted => 'not-started',
            SuperBoardFlowUserState.inProgress => 'in-progress',
            SuperBoardFlowUserState.completed => 'completed',
            SuperBoardFlowUserState.stopped => 'stopped',
          },
          if (workflow.enteredAt != null)
            'entered_at': workflow.enteredAt!.toUtc().toIso8601String(),
          if (workflow.exitedAt != null)
            'exited_at': workflow.exitedAt!.toUtc().toIso8601String(),
        },
    ],
  });
}

String superboardFlowsCurrentFloatingBlocksJson() =>
    superBoardFlowBlocksToJson(SuperBoardFlows.instance.floatingBlocks);

String superboardFlowsCurrentSlotBlocksJson(String slotId) =>
    superBoardFlowBlocksToJson(SuperBoardFlows.instance.slotBlocks(slotId));

Future<bool> superboardFlowsNotifyNavigation(String location) async {
  await SuperBoardFlows.instance.notifyNavigation(location);
  return true;
}

Future<bool> superboardFlowsNotifyAnchorInteraction(String anchorName) async {
  final value = anchorName.trim();
  if (value.isEmpty) {
    throw ArgumentError.value(anchorName, 'anchorName');
  }
  SuperBoardFlowAnchors.instance.notifyInteraction(value);
  return true;
}

Future<bool> superboardFlowsDispose() async {
  await SuperBoardFlows.dispose();
  return true;
}

/// Invisible FlutterFlow custom widget that owns the Flows lifecycle.
class SuperBoardFlowsBootstrap extends StatefulWidget {
  const SuperBoardFlowsBootstrap({
    super.key,
    required this.apiUrl,
    required this.projectId,
    required this.environment,
    required this.userId,
    this.sdkKey = '',
    this.language = 'disabled',
    this.userPropertiesJson = '{}',
    this.debug = false,
    this.realtime = true,
    this.width,
    this.height,
    this.onInitialized,
    this.onError,
    this.navigationAdapter,
  });

  final String apiUrl;
  final String projectId;
  final String environment;
  final String userId;
  final String sdkKey;
  final String language;
  final String userPropertiesJson;
  final bool debug;
  final bool realtime;
  final double? width;
  final double? height;
  final Future<void> Function()? onInitialized;
  final Future<void> Function(String message)? onError;
  final SuperBoardFlowNavigationAdapter? navigationAdapter;

  @override
  State<SuperBoardFlowsBootstrap> createState() =>
      _SuperBoardFlowsBootstrapState();
}

class _SuperBoardFlowsBootstrapState extends State<SuperBoardFlowsBootstrap> {
  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await SuperBoardFlows.initialize(
        apiUrl: widget.apiUrl,
        projectId: widget.projectId,
        environment: widget.environment,
        userId: widget.userId,
        sdkKey: widget.sdkKey,
        language: widget.language,
        userProperties: _decodeObject(
          widget.userPropertiesJson,
          'userPropertiesJson',
        ),
        debug: widget.debug,
        realtime: widget.realtime,
        navigationAdapter: widget.navigationAdapter,
      );
      await widget.onInitialized?.call();
    } catch (error) {
      await widget.onError?.call(error.toString());
    }
  }

  @override
  Widget build(BuildContext context) =>
      SizedBox(width: widget.width, height: widget.height);
}

/// FlutterFlow-friendly slot widget. It delegates rendering to the native SDK.
class SuperBoardFlutterFlowFlowsSlot extends StatelessWidget {
  const SuperBoardFlutterFlowFlowsSlot({
    super.key,
    required this.slotId,
    this.width,
    this.height,
  });

  final String slotId;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    height: height,
    child: SuperBoardFlowsSlot(slotId: slotId),
  );
}

/// FlutterFlow-friendly host for floating native Flow components.
class SuperBoardFlutterFlowFlowsOverlay extends StatelessWidget {
  const SuperBoardFlutterFlowFlowsOverlay({
    super.key,
    this.width,
    this.height,
    this.showDebugOverlay = false,
  });

  final double? width;
  final double? height;
  final bool showDebugOverlay;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    height: height,
    child: SuperBoardFlowsOverlay(
      showDebugOverlay: showDebugOverlay,
      child: const SizedBox.expand(),
    ),
  );
}

/// Non-interactive FlutterFlow target region for hints, tooltips, and tours.
///
/// Add [superboardFlowsNotifyAnchorInteraction] to the target control's action
/// chain when a workflow uses a click trigger. The region itself ignores
/// pointers so it never blocks the real FlutterFlow control underneath it.
class SuperBoardFlutterFlowFlowAnchor extends StatelessWidget {
  const SuperBoardFlutterFlowFlowAnchor({
    super.key,
    required this.anchorName,
    this.width,
    this.height,
  });

  final String anchorName;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: SuperBoardFlowAnchor(
      name: anchorName,
      child: SizedBox(width: width, height: height),
    ),
  );
}

Map<String, dynamic> _decodeObject(String value, String field) {
  final decoded = jsonDecode(value);
  if (decoded is! Map) {
    throw FormatException('$field must contain a JSON object');
  }
  return decoded.map((key, item) => MapEntry(key.toString(), item));
}
