import 'dart:convert';

enum SuperBoardFlowBlockType { component, tour, survey, wait }

enum SuperBoardFlowWorkflowStatus { enabled, launchpadEnabled }

enum SuperBoardFlowWorkflowFrequency { once, everyTime }

enum SuperBoardFlowUserState { notStarted, inProgress, completed, stopped }

enum SuperBoardFlowEventName {
  transition,
  tourUpdate,
  resetProgress,
  workflowStart,
  enter,
  workflowExit,
  identify,
  setStateMemory,
  blockActivated,
  surveySubmit,
}

extension SuperBoardFlowEventNameWire on SuperBoardFlowEventName {
  String get wireName => switch (this) {
    SuperBoardFlowEventName.transition => 'transition',
    SuperBoardFlowEventName.tourUpdate => 'tour-update',
    SuperBoardFlowEventName.resetProgress => 'reset-progress',
    SuperBoardFlowEventName.workflowStart => 'workflow-start',
    SuperBoardFlowEventName.enter => 'enter',
    SuperBoardFlowEventName.workflowExit => 'workflow-exit',
    SuperBoardFlowEventName.identify => 'identify',
    SuperBoardFlowEventName.setStateMemory => 'set-state-memory',
    SuperBoardFlowEventName.blockActivated => 'block-activated',
    SuperBoardFlowEventName.surveySubmit => 'survey-submit',
  };
}

class SuperBoardFlowException implements Exception {
  const SuperBoardFlowException(
    this.message, {
    this.code = 'flows_request_failed',
    this.statusCode,
    this.retryable = false,
    this.requestId,
  });

  final String message;
  final String code;
  final int? statusCode;
  final bool retryable;
  final String? requestId;

  @override
  String toString() => 'SuperBoardFlowException($code): $message';
}

class SuperBoardFlowPropertyMeta {
  const SuperBoardFlowPropertyMeta({
    required this.key,
    required this.type,
    this.value,
    this.triggers = const [],
  });

  final String key;
  final String type;
  final Object? value;
  final List<Map<String, dynamic>> triggers;

  factory SuperBoardFlowPropertyMeta.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowPropertyMeta(
        key: _requiredString(json, 'key'),
        type: _requiredString(json, 'type'),
        value: json['value'],
        triggers: _mapList(json['triggers']),
      );
}

class SuperBoardFlowSurveyOption {
  const SuperBoardFlowSurveyOption({required this.id, required this.label});

  final String id;
  final String label;

  factory SuperBoardFlowSurveyOption.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowSurveyOption(
        id: _requiredString(json, 'id'),
        label: _requiredString(json, 'label'),
      );

  Map<String, dynamic> toJson() => {'id': id, 'label': label};
}

class SuperBoardFlowSurveyQuestion {
  const SuperBoardFlowSurveyQuestion({
    required this.id,
    required this.type,
    required this.title,
    this.description,
    this.optional = false,
    this.shuffleOptions = false,
    this.otherOption = false,
    this.otherLabel,
    this.displayType,
    this.minValue,
    this.maxValue,
    this.lowerBoundLabel,
    this.upperBoundLabel,
    this.textPlaceholder,
    this.linkLabel,
    this.url,
    this.openInNew = false,
    this.options = const [],
  });

  final String id;
  final String type;
  final String title;
  final String? description;
  final bool optional;
  final bool shuffleOptions;
  final bool otherOption;
  final String? otherLabel;
  final String? displayType;
  final num? minValue;
  final num? maxValue;
  final String? lowerBoundLabel;
  final String? upperBoundLabel;
  final String? textPlaceholder;
  final String? linkLabel;
  final String? url;
  final bool openInNew;
  final List<SuperBoardFlowSurveyOption> options;

  factory SuperBoardFlowSurveyQuestion.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowSurveyQuestion(
        id: _requiredString(json, 'id'),
        type: _requiredString(json, 'type'),
        title: _requiredString(json, 'title'),
        description: _optionalString(json['description']),
        optional: json['optional'] == true,
        shuffleOptions: json['shuffleOptions'] == true,
        otherOption: json['otherOption'] == true,
        otherLabel: _optionalString(json['otherLabel']),
        displayType: _optionalString(json['displayType']),
        minValue: json['minValue'] as num?,
        maxValue: json['maxValue'] as num?,
        lowerBoundLabel: _optionalString(json['lowerBoundLabel']),
        upperBoundLabel: _optionalString(json['upperBoundLabel']),
        textPlaceholder: _optionalString(json['textPlaceholder']),
        linkLabel: _optionalString(json['linkLabel']),
        url: _optionalString(json['url']),
        openInNew: json['openInNew'] == true,
        options: _objectList(
          json['options'],
        ).map(SuperBoardFlowSurveyOption.fromJson).toList(growable: false),
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'title': title,
    if (description != null) 'description': description,
    'optional': optional,
    'shuffleOptions': shuffleOptions,
    'otherOption': otherOption,
    if (otherLabel != null) 'otherLabel': otherLabel,
    if (displayType != null) 'displayType': displayType,
    if (minValue != null) 'minValue': minValue,
    if (maxValue != null) 'maxValue': maxValue,
    if (lowerBoundLabel != null) 'lowerBoundLabel': lowerBoundLabel,
    if (upperBoundLabel != null) 'upperBoundLabel': upperBoundLabel,
    if (textPlaceholder != null) 'textPlaceholder': textPlaceholder,
    if (linkLabel != null) 'linkLabel': linkLabel,
    if (url != null) 'url': url,
    'openInNew': openInNew,
    if (options.isNotEmpty)
      'options': options.map((option) => option.toJson()).toList(),
  };
}

class SuperBoardFlowSurvey {
  const SuperBoardFlowSurvey({
    required this.id,
    required this.blockStateId,
    required this.questions,
  });

  final String id;
  final String blockStateId;
  final List<SuperBoardFlowSurveyQuestion> questions;

  factory SuperBoardFlowSurvey.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowSurvey(
        id: _requiredString(json, 'id'),
        blockStateId: _optionalString(json['blockStateId']) ?? '',
        questions: _objectList(
          json['questions'],
        ).map(SuperBoardFlowSurveyQuestion.fromJson).toList(growable: false),
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'blockStateId': blockStateId,
    'questions': questions.map((question) => question.toJson()).toList(),
  };
}

class SuperBoardFlowBlock {
  const SuperBoardFlowBlock({
    required this.id,
    required this.workflowId,
    required this.type,
    required this.data,
    required this.exitNodes,
    this.blockStateId,
    this.componentLibraryName,
    this.key,
    this.componentType,
    this.propertyMeta = const [],
    this.slottable = false,
    this.slotId,
    this.slotIndex,
    this.pageTargetingOperator,
    this.pageTargetingValues = const [],
    this.tourTrigger,
    this.tourWait,
    this.tourBlocks = const [],
    this.currentTourIndex,
    this.survey,
  });

  final String id;
  final String? blockStateId;
  final String workflowId;
  final String? componentLibraryName;
  final String? key;
  final SuperBoardFlowBlockType type;
  final String? componentType;
  final Map<String, dynamic> data;
  final List<SuperBoardFlowPropertyMeta> propertyMeta;
  final List<String> exitNodes;
  final bool slottable;
  final String? slotId;
  final int? slotIndex;
  final String? pageTargetingOperator;
  final List<String> pageTargetingValues;
  final Map<String, dynamic>? tourTrigger;
  final Map<String, dynamic>? tourWait;
  final List<SuperBoardFlowBlock> tourBlocks;
  final int? currentTourIndex;
  final SuperBoardFlowSurvey? survey;

  bool get isFloating => !slottable || slotId == null || slotId!.isEmpty;

  /// Component props exactly as rendered by the upstream SDKs.
  ///
  /// Static definition values live in [data], while typed action, state-memory,
  /// and block-state values are supplied in [propertyMeta]. Native components
  /// consume the merged view but the original wire fields remain unchanged.
  Map<String, dynamic> get resolvedData {
    final result = _copyObject(data);
    for (final property in propertyMeta) {
      if (property.value != null) {
        _setPath(result, property.key.split('.'), property.value);
      }
    }
    return Map.unmodifiable(result);
  }

  factory SuperBoardFlowBlock.fromJson(Map<String, dynamic> json) {
    final rawType = _requiredString(json, 'type');
    final type = switch (rawType) {
      'component' => SuperBoardFlowBlockType.component,
      'tour' || 'tour-component' => SuperBoardFlowBlockType.tour,
      'survey' => SuperBoardFlowBlockType.survey,
      'wait' => SuperBoardFlowBlockType.wait,
      _ => throw FormatException('Unsupported Flows block type: $rawType'),
    };
    final tourTrigger = json['tour_trigger'] ?? json['tourTrigger'];
    return SuperBoardFlowBlock(
      id: _requiredString(json, 'id'),
      blockStateId: _optionalString(json['blockStateId']),
      workflowId: _requiredString(json, 'workflowId'),
      componentLibraryName: _optionalString(json['componentLibraryName']),
      key: _optionalString(json['key']),
      type: type,
      componentType: _optionalString(json['componentType']),
      data: _object(json['data']),
      propertyMeta: _objectList(
        json['propertyMeta'],
      ).map(SuperBoardFlowPropertyMeta.fromJson).toList(growable: false),
      exitNodes: _stringList(json['exitNodes']),
      slottable: json['slottable'] == true,
      slotId: _optionalString(json['slotId']),
      slotIndex: (json['slotIndex'] as num?)?.toInt(),
      pageTargetingOperator: _optionalString(
        json['page_targeting_operator'] ?? json['pageTargetingOperator'],
      ),
      pageTargetingValues: _stringList(
        json['page_targeting_values'] ?? json['pageTargetingValues'],
      ),
      tourTrigger: tourTrigger is Map ? _object(tourTrigger) : null,
      tourWait: json['tourWait'] is Map ? _object(json['tourWait']) : null,
      tourBlocks: _objectList(
        json['tourBlocks'],
      ).map(SuperBoardFlowBlock.fromJson).toList(growable: false),
      currentTourIndex: (json['currentTourIndex'] as num?)?.toInt(),
      survey: json['survey'] is Map
          ? SuperBoardFlowSurvey.fromJson(_object(json['survey']))
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    if (blockStateId != null) 'blockStateId': blockStateId,
    'workflowId': workflowId,
    if (componentLibraryName != null)
      'componentLibraryName': componentLibraryName,
    if (key != null) 'key': key,
    'type': type.name,
    if (componentType != null) 'componentType': componentType,
    'data': data,
    'propertyMeta': [
      for (final property in propertyMeta)
        {
          'key': property.key,
          'type': property.type,
          if (property.value != null) 'value': property.value,
          if (property.triggers.isNotEmpty) 'triggers': property.triggers,
        },
    ],
    'exitNodes': exitNodes,
    'slottable': slottable,
    if (slotId != null) 'slotId': slotId,
    if (slotIndex != null) 'slotIndex': slotIndex,
    if (pageTargetingOperator != null)
      'page_targeting_operator': pageTargetingOperator,
    if (pageTargetingValues.isNotEmpty)
      'page_targeting_values': pageTargetingValues,
    if (tourTrigger != null) 'tour_trigger': tourTrigger,
    if (tourWait != null) 'tourWait': tourWait,
    if (tourBlocks.isNotEmpty)
      'tourBlocks': tourBlocks.map((block) => block.toJson()).toList(),
    if (currentTourIndex != null) 'currentTourIndex': currentTourIndex,
    if (survey != null) 'survey': survey!.toJson(),
  };
}

class SuperBoardFlowBlocksSnapshot {
  const SuperBoardFlowBlocksSnapshot({required this.blocks});

  final List<SuperBoardFlowBlock> blocks;

  factory SuperBoardFlowBlocksSnapshot.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowBlocksSnapshot(
        blocks: _objectList(
          json['blocks'],
        ).map(SuperBoardFlowBlock.fromJson).toList(growable: false),
      );
}

class SuperBoardFlowBlockUpdate {
  const SuperBoardFlowBlockUpdate({
    required this.exitedBlockIds,
    required this.updatedBlocks,
  });

  final List<String> exitedBlockIds;
  final List<SuperBoardFlowBlock> updatedBlocks;

  factory SuperBoardFlowBlockUpdate.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowBlockUpdate(
        exitedBlockIds: _stringList(json['exitedBlockIds']),
        updatedBlocks: _objectList(
          json['updatedBlocks'],
        ).map(SuperBoardFlowBlock.fromJson).toList(growable: false),
      );
}

class SuperBoardFlowWorkflow {
  const SuperBoardFlowWorkflow({
    required this.id,
    required this.status,
    required this.frequency,
    required this.userState,
    this.enteredAt,
    this.exitedAt,
  });

  final String id;
  final SuperBoardFlowWorkflowStatus status;
  final SuperBoardFlowWorkflowFrequency frequency;
  final SuperBoardFlowUserState userState;
  final DateTime? enteredAt;
  final DateTime? exitedAt;

  factory SuperBoardFlowWorkflow.fromJson(Map<String, dynamic> json) =>
      SuperBoardFlowWorkflow(
        id: _requiredString(json, 'id'),
        status: json['workflow_status'] == 'launchpad-enabled'
            ? SuperBoardFlowWorkflowStatus.launchpadEnabled
            : SuperBoardFlowWorkflowStatus.enabled,
        frequency: json['frequency'] == 'every-time'
            ? SuperBoardFlowWorkflowFrequency.everyTime
            : SuperBoardFlowWorkflowFrequency.once,
        userState: switch (json['user_state']) {
          'in-progress' => SuperBoardFlowUserState.inProgress,
          'completed' => SuperBoardFlowUserState.completed,
          'stopped' => SuperBoardFlowUserState.stopped,
          _ => SuperBoardFlowUserState.notStarted,
        },
        enteredAt: DateTime.tryParse(json['entered_at']?.toString() ?? ''),
        exitedAt: DateTime.tryParse(json['exited_at']?.toString() ?? ''),
      );
}

class SuperBoardFlowSurveyAnswer {
  const SuperBoardFlowSurveyAnswer({
    required this.questionId,
    this.textResponse,
    this.optionIds = const [],
    this.otherSelected = false,
    this.clickedLink = false,
  });

  final String questionId;
  final String? textResponse;
  final List<String> optionIds;
  final bool otherSelected;
  final bool clickedLink;

  Map<String, dynamic> toJson() => {
    'questionId': questionId,
    if (textResponse != null) 'textResponse': textResponse,
    if (optionIds.isNotEmpty) 'optionIds': optionIds,
    if (otherSelected) 'otherSelected': true,
    if (clickedLink) 'clickedLink': true,
  };
}

String superBoardFlowBlocksToJson(List<SuperBoardFlowBlock> blocks) =>
    jsonEncode(blocks.map((block) => block.toJson()).toList(growable: false));

Map<String, dynamic> _object(Object? value) => value is Map
    ? value.map((key, item) => MapEntry(key.toString(), item))
    : <String, dynamic>{};

Map<String, dynamic> _copyObject(Map<String, dynamic> value) =>
    value.map((key, item) => MapEntry(key, _copyValue(item)));

Object? _copyValue(Object? value) {
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), _copyValue(item)));
  }
  if (value is List) return value.map(_copyValue).toList(growable: true);
  return value;
}

void _setPath(Map<String, dynamic> root, List<String> segments, Object? value) {
  if (segments.isEmpty) return;
  Object current = root;
  for (var index = 0; index < segments.length; index += 1) {
    final segment = segments[index];
    final last = index == segments.length - 1;
    if (current is Map<String, dynamic>) {
      if (last) {
        current[segment] = _copyValue(value);
        return;
      }
      final nextSegmentIsIndex = int.tryParse(segments[index + 1]) != null;
      current = current.putIfAbsent(
        segment,
        () => nextSegmentIsIndex ? <dynamic>[] : <String, dynamic>{},
      );
      continue;
    }
    if (current is List<dynamic>) {
      final listIndex = int.tryParse(segment);
      if (listIndex == null || listIndex < 0) return;
      while (current.length <= listIndex) {
        current.add(null);
      }
      if (last) {
        current[listIndex] = _copyValue(value);
        return;
      }
      final nextSegmentIsIndex = int.tryParse(segments[index + 1]) != null;
      current = current[listIndex] ??= nextSegmentIsIndex
          ? <dynamic>[]
          : <String, dynamic>{};
      continue;
    }
    return;
  }
}

List<Map<String, dynamic>> _objectList(Object? value) => value is List
    ? value.whereType<Map>().map(_object).toList(growable: false)
    : const [];

List<Map<String, dynamic>> _mapList(Object? value) => _objectList(value);

List<String> _stringList(Object? value) => value is List
    ? value.map((item) => item.toString()).toList(growable: false)
    : const [];

String _requiredString(Map<String, dynamic> json, String key) {
  final value = _optionalString(json[key]);
  if (value == null) throw FormatException('Missing Flows field: $key');
  return value;
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  final result = value.toString();
  return result.isEmpty ? null : result;
}
