// ignore_for_file: deprecated_member_use_from_same_package

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'experience_client.dart';
import 'application_actions.dart'
    show superboardApplicationUpdateMarketingConsentJson;

typedef SuperBoardMarketingConsentUpdater =
    Future<String> Function({
      required bool consented,
      required String idempotencyKey,
      String attributesJson,
      String listIdsJson,
    });

/// Compatibility widget backed by the Onboardings aliases served by Flows.
@Deprecated('Use SuperBoardFlowsOverlay, SuperBoardFlowsSlot, or a tour Flow.')
class SuperBoardOnboarding extends StatefulWidget {
  const SuperBoardOnboarding({
    super.key,
    this.width,
    this.height,
    this.placement = 'app_launch',
    this.customerId,
    this.anonymousId,
    this.appVersion,
    this.locale,
    this.attributes = const {},
    this.onCompleted,
    this.onSkipped,
    this.onClosed,
    this.onUnavailable,
    this.onAnswersChanged,
    this.resumeProgress,
    this.fallbackTitle = '',
    this.fallbackBody = '',
    @visibleForTesting this.experienceClient,
    @visibleForTesting this.marketingConsentUpdater,
  });

  final double? width;
  final double? height;
  final String placement;
  final String? customerId;
  final String? anonymousId;
  final String? appVersion;
  final String? locale;
  final Map<String, dynamic> attributes;
  final VoidCallback? onCompleted;
  final VoidCallback? onSkipped;
  final VoidCallback? onClosed;
  final VoidCallback? onUnavailable;
  final ValueChanged<Map<String, String>>? onAnswersChanged;
  final bool? resumeProgress;
  final String fallbackTitle;
  final String fallbackBody;
  final SuperBoardExperienceClient? experienceClient;
  final SuperBoardMarketingConsentUpdater? marketingConsentUpdater;

  @override
  State<SuperBoardOnboarding> createState() => _SuperBoardOnboardingState();
}

class _SuperBoardOnboardingState extends State<SuperBoardOnboarding> {
  late final String _anonymousId = widget.anonymousId?.trim().isNotEmpty == true
      ? widget.anonymousId!.trim()
      : 'onboarding_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_${Random.secure().nextInt(0x7fffffff).toRadixString(36)}';
  SuperBoardResolvedExperience? _resolved;
  List<Map<String, dynamic>> _screens = const [];
  int _index = 0;
  bool _loaded = false;
  bool _terminal = false;
  bool _savingMarketingConsent = false;
  String? _error;
  String? _marketingConsentError;
  String? _questionError;
  final Map<String, String> _answers = {};
  final List<int> _routeHistory = [];
  final FlutterSecureStorage _progressStorage = const FlutterSecureStorage();
  Future<void> _progressWrite = Future<void>.value();
  final Map<String, bool> _marketingConsents = {};
  final Set<String> _persistedMarketingConsents = {};

  SuperBoardExperienceClient get _client =>
      widget.experienceClient ?? SuperBoardExperienceSdk.client;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final resolved = await _client.resolveOnboarding(
        placement: widget.placement,
        customerId: widget.customerId,
        anonymousId: _anonymousId,
        appVersion: widget.appVersion,
        locale: widget.locale,
        attributes: widget.attributes,
      );
      final screens = resolved?.definition['screens'];
      final parsed = screens is List
          ? screens
                .whereType<Map>()
                .map((value) => value.cast<String, dynamic>())
                .toList()
          : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _resolved = resolved;
        _screens = parsed;
        _loaded = true;
        _error = resolved != null && parsed.isEmpty
            ? 'The active onboarding has no screens.'
            : null;
      });
      if (resolved == null) {
        widget.onUnavailable?.call();
        return;
      }
      await _restoreProgress();
      if (!mounted) return;
      await _track('impression');
      await _track('step_view', stepId: _screenId);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loaded = true;
        _error = error.toString();
      });
      widget.onUnavailable?.call();
    }
  }

  String? get _screenId =>
      _screens.isEmpty ? null : _screens[_index]['id']?.toString();

  Future<void> _track(
    String type, {
    String? stepId,
    Map<String, dynamic> payload = const {},
  }) async {
    final resolved = _resolved;
    if (resolved == null) return;
    await _client.track(
      SuperBoardExperienceEvent(
        type: type,
        resolved: resolved,
        platform: _client.platform,
        stepId: stepId,
        customerId: widget.customerId,
        payload: {'anonymous_id': _anonymousId, ...payload},
      ),
    );
  }

  bool _validateQuestions() {
    if (_screens.isEmpty) return false;
    final blocks = _screens[_index]['blocks'];
    if (blocks is List) {
      for (final raw in blocks.whereType<Map>()) {
        if (raw['type'] != 'question' || raw['props'] is! Map) continue;
        final props = raw['props'] as Map;
        final attribute =
            props['attribute']?.toString() ?? raw['id'].toString();
        if (props['required'] == true &&
            (_answers[attribute]?.isEmpty ?? true)) {
          setState(
            () => _questionError =
                props['required_message']?.toString() ??
                ((widget.locale ?? '').startsWith('fr')
                    ? 'Choisissez une réponse pour continuer.'
                    : 'Choose an answer to continue.'),
          );
          return false;
        }
      }
    }
    return true;
  }

  Future<void> _next() async {
    if (_terminal || _screens.isEmpty) return;
    if (!_validateQuestions()) return;
    final blocks = _screens[_index]['blocks'];
    if (!await _persistMarketingConsent()) return;
    await _track(
      'progress',
      stepId: _screenId,
      payload: {
        'screen_index': _index,
        'screen_count': _screens.length,
        'answers': Map<String, String>.from(_answers),
      },
    );
    final current = _screens[_index];
    String? nextId = current['next_screen_id']?.toString();
    if (blocks is List) {
      for (final raw in blocks.whereType<Map>()) {
        if (raw['type'] != 'question' || raw['props'] is! Map) continue;
        final props = raw['props'] as Map;
        final options = props['options'];
        if (options is! List) continue;
        final answer =
            _answers[props['attribute']?.toString() ?? raw['id'].toString()];
        for (final option in options.whereType<Map>()) {
          if (option['value'] == answer && option['next_screen_id'] is String) {
            nextId = option['next_screen_id'] as String;
            break;
          }
        }
      }
    }
    final explicitIndex = nextId == null
        ? -1
        : _screens.indexWhere((screen) => screen['id']?.toString() == nextId);
    var nextIndex = explicitIndex >= 0 ? explicitIndex : _index + 1;
    final visited = <int>{};
    while (nextIndex < _screens.length &&
        !_screenMatches(_screens[nextIndex]) &&
        visited.add(nextIndex)) {
      final next = _screens[nextIndex]['next_screen_id']?.toString();
      final target = next == null
          ? -1
          : _screens.indexWhere((screen) => screen['id'] == next);
      nextIndex = target >= 0 ? target : nextIndex + 1;
    }
    if (visited.contains(nextIndex)) nextIndex = _screens.length;
    if (nextIndex >= _screens.length) {
      await _complete(persistMarketingConsent: false);
      return;
    }
    if (!mounted) return;
    setState(() {
      _routeHistory.add(_index);
      _index = nextIndex;
      _questionError = null;
    });
    await _persistProgress();
    await _track('step_view', stepId: _screenId);
  }

  Future<void> _back() async {
    if (_index <= 0 || _terminal) return;
    await _track('back', stepId: _screenId);
    if (!mounted) return;
    setState(
      () => _index = _routeHistory.isNotEmpty
          ? _routeHistory.removeLast()
          : _index - 1,
    );
    await _persistProgress();
    await _track('step_view', stepId: _screenId);
  }

  Future<void> _skip() async {
    if (_terminal) return;
    _terminal = true;
    await _track('skip', stepId: _screenId);
    widget.onSkipped?.call();
  }

  Future<void> _complete({bool persistMarketingConsent = true}) async {
    if (_terminal || !_validateQuestions()) return;
    if (persistMarketingConsent && !await _persistMarketingConsent()) return;
    _terminal = true;
    await _clearProgress();
    await _track(
      'complete',
      stepId: _screenId,
      payload: {'answers': Map<String, String>.from(_answers)},
    );
    widget.onCompleted?.call();
  }

  Future<void> _close() async {
    if (!_terminal) {
      _terminal = true;
      await _track('abandon', stepId: _screenId, payload: {'source': 'close'});
    }
    widget.onClosed?.call();
  }

  Future<bool> _persistMarketingConsent() async {
    if (_screens.isEmpty || _savingMarketingConsent) return false;
    final screen = _screens[_index];
    final blocks = screen['blocks'] is List
        ? (screen['blocks'] as List)
              .whereType<Map>()
              .map((value) => value.cast<String, dynamic>())
              .toList()
        : <Map<String, dynamic>>[];
    final consentBlocks = <({Map<String, dynamic> block, int index})>[
      for (var index = 0; index < blocks.length; index += 1)
        if (blocks[index]['type'] == 'marketing_consent')
          (block: blocks[index], index: index),
    ];
    if (consentBlocks.isEmpty) return true;
    final resolved = _resolved;
    if (resolved == null) return false;
    if (mounted) {
      setState(() {
        _savingMarketingConsent = true;
        _marketingConsentError = null;
      });
    }
    try {
      final updater =
          widget.marketingConsentUpdater ??
          superboardApplicationUpdateMarketingConsentJson;
      for (final entry in consentBlocks) {
        final props = entry.block['props'] is Map
            ? (entry.block['props'] as Map).cast<String, dynamic>()
            : const <String, dynamic>{};
        final blockKey = _marketingConsentBlockKey(entry.block, entry.index);
        final consented = _marketingConsents[blockKey] ?? false;
        final persistenceKey = '$blockKey:${consented ? 'in' : 'out'}';
        if (_persistedMarketingConsents.contains(persistenceKey)) continue;
        final attributes = props['attributes'] is Map
            ? (props['attributes'] as Map).cast<String, dynamic>()
            : const <String, dynamic>{};
        final listIds = props['list_ids'] is List
            ? (props['list_ids'] as List)
                  .map((value) => value.toString())
                  .where((value) => value.trim().isNotEmpty)
                  .toList()
            : const <String>[];
        await updater(
          consented: consented,
          idempotencyKey: _marketingConsentIdempotencyKey(
            resolved: resolved,
            blockKey: blockKey,
            consented: consented,
          ),
          attributesJson: jsonEncode(attributes),
          listIdsJson: jsonEncode(listIds),
        );
        _persistedMarketingConsents.add(persistenceKey);
      }
      return true;
    } catch (error) {
      if (mounted) {
        setState(() {
          _marketingConsentError =
              'Your newsletter preference could not be saved. Please retry.';
        });
      }
      return false;
    } finally {
      if (mounted) {
        setState(() => _savingMarketingConsent = false);
      }
    }
  }

  String? get _progressKey {
    final subject = widget.customerId ?? widget.anonymousId;
    final metadata = _resolved?.definition['metadata'];
    final enabled =
        widget.resumeProgress ??
        (metadata is Map && metadata['resume_progress'] == true);
    if (!enabled || subject == null || subject.isEmpty) return null;
    return 'superboard.onboarding.' +
        base64Url.encode(
          utf8.encode(
            [
              _client.baseUrl,
              _client.projectKey,
              _client.environment,
              widget.placement,
              subject,
            ].join(':'),
          ),
        );
  }

  Future<void> _persistProgress() async {
    final key = _progressKey;
    if (key == null || _resolved == null) return;
    final value = jsonEncode({
      'version': _resolved!.versionId,
      'screen': _screenId,
      'answers': _answers,
      'history': _routeHistory,
      'saved_at': DateTime.now().toUtc().toIso8601String(),
    });
    _progressWrite = _progressWrite.then((_) async {
      try {
        await _progressStorage.write(key: key, value: value);
      } catch (_) {
        return;
      }
    });
    await _progressWrite;
  }

  Future<void> _restoreProgress() async {
    final key = _progressKey;
    if (key == null) return;
    try {
      final raw = await _progressStorage.read(key: key);
      if (raw == null) return;
      final saved = jsonDecode(raw);
      if (saved is! Map || saved['version'] != _resolved?.versionId) return;
      final date = DateTime.tryParse(saved['saved_at']?.toString() ?? '');
      if (date == null ||
          DateTime.now().difference(date) > const Duration(days: 30))
        return;
      final index = _screens.indexWhere(
        (screen) => screen['id'] == saved['screen'],
      );
      if (!mounted || index < 0) return;
      setState(() {
        _index = index;
        final answers = saved['answers'];
        if (answers is Map)
          for (final entry in answers.entries) {
            if (entry.key is String && entry.value is String)
              _answers[entry.key as String] = entry.value as String;
          }
        final history = saved['history'];
        if (history is List)
          _routeHistory.addAll(
            history.whereType<int>().where(
              (item) => item >= 0 && item < _screens.length,
            ),
          );
      });
    } catch (_) {
      return;
    }
  }

  Future<void> _clearProgress() async {
    final key = _progressKey;
    if (key == null) return;
    await _progressWrite;
    try {
      await _progressStorage.delete(key: key);
    } catch (_) {
      return;
    }
  }

  bool _screenMatches(Map<String, dynamic> screen) {
    final conditions = screen['conditions'];
    if (conditions is! Map) return true;
    if (conditions['platform'] != null &&
        conditions['platform'] != _client.platform)
      return false;
    if (conditions['locale'] != null && conditions['locale'] != widget.locale)
      return false;
    final minimum = conditions['min_app_version']?.toString();
    if (minimum != null) {
      final expected = minimum
          .split('.')
          .map((part) => int.tryParse(part) ?? 0)
          .toList();
      final actual = (widget.appVersion ?? '0')
          .split('.')
          .map((part) => int.tryParse(part) ?? 0)
          .toList();
      for (
        var index = 0;
        index < max(expected.length, actual.length);
        index++
      ) {
        final left = index < actual.length ? actual[index] : 0;
        final right = index < expected.length ? expected[index] : 0;
        if (left != right) return left > right;
      }
    }
    return true;
  }

  String _interpolate(Object? value) =>
      (value?.toString() ?? '').replaceAllMapped(
        RegExp(r'\{\{\s*(\w+)\s*\}\}'),
        (match) =>
            _answers[match[1]] ??
            widget.attributes[match[1]]?.toString() ??
            match[0]!,
      );

  String _marketingConsentBlockKey(
    Map<String, dynamic> block,
    int blockIndex,
  ) =>
      '${_screenId ?? _index}:${block['id']?.toString() ?? blockIndex.toString()}';

  String _marketingConsentIdempotencyKey({
    required SuperBoardResolvedExperience resolved,
    required String blockKey,
    required bool consented,
  }) {
    final raw =
        'onboarding-consent:${resolved.versionId}:$_anonymousId:$blockKey:${consented ? 'in' : 'out'}';
    final normalized = raw.replaceAll(RegExp(r'[^A-Za-z0-9._:-]'), '_');
    return normalized.length <= 255 ? normalized : normalized.substring(0, 255);
  }

  @override
  void dispose() {
    if (!_terminal && _resolved != null) {
      _terminal = true;
      unawaited(
        _track(
          'abandon',
          stepId: _screenId,
          payload: {'source': 'widget_disposed'},
        ),
      );
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_resolved == null) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: widget.fallbackTitle.isEmpty
            ? null
            : Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      widget.fallbackTitle,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    if (widget.fallbackBody.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(widget.fallbackBody, textAlign: TextAlign.center),
                    ],
                  ],
                ),
              ),
      );
    }
    if (_error != null) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: Center(
          child: Text(
            _error!,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      );
    }
    final screen = _screens[_index];
    final blocks = screen['blocks'] is List
        ? (screen['blocks'] as List)
              .whereType<Map>()
              .map((value) => value.cast<String, dynamic>())
              .toList()
        : <Map<String, dynamic>>[];
    final theme = _resolved!.definition['theme'] is Map
        ? (_resolved!.definition['theme'] as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    final accent = _color(
      theme['accent_color']?.toString(),
      const Color(0xFF6366F1),
    );
    final background = _color(
      theme['background_color']?.toString(),
      Theme.of(context).colorScheme.surface,
    );
    final textColor = _color(
      theme['text_color']?.toString(),
      Theme.of(context).colorScheme.onSurface,
    );
    final radius = (theme['corner_radius'] as num?)?.toDouble() ?? 14;
    final hasAction = blocks.any((block) => block['type'] == 'button');
    final content = SizedBox(
      width: widget.width,
      height: widget.height,
      child: Material(
        color: background,
        child: SafeArea(
          child: Column(
            children: [
              Row(
                children: [
                  if (_index > 0)
                    IconButton(
                      onPressed: _back,
                      icon: const Icon(Icons.arrow_back),
                    )
                  else
                    const SizedBox(width: 48),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: (_index + 1) / _screens.length,
                      color: accent,
                    ),
                  ),
                  IconButton(onPressed: _close, icon: const Icon(Icons.close)),
                ],
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: DefaultTextStyle.merge(
                    style: TextStyle(color: textColor),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (
                          var index = 0;
                          index < blocks.length;
                          index += 1
                        ) ...[
                          _block(blocks[index], index, accent, radius),
                          const SizedBox(height: 14),
                        ],
                        if (_marketingConsentError != null) ...[
                          Text(
                            _marketingConsentError!,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                          const SizedBox(height: 14),
                        ],
                        if (_questionError != null)
                          Text(
                            _questionError!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        if (!hasAction)
                          FilledButton(
                            onPressed: _savingMarketingConsent ? null : _next,
                            style: FilledButton.styleFrom(
                              backgroundColor: accent,
                            ),
                            child: Text(
                              _index == _screens.length - 1
                                  ? 'Get started'
                                  : 'Continue',
                            ),
                          ),
                        TextButton(
                          onPressed: _savingMarketingConsent ? null : _skip,
                          child: const Text('Skip'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return Directionality(
      textDirection:
          RegExp(r'^(ar|fa|he|ur)(-|$)').hasMatch(widget.locale ?? '')
          ? TextDirection.rtl
          : Directionality.of(context),
      child: content,
    );
  }

  Widget _block(
    Map<String, dynamic> block,
    int blockIndex,
    Color accent,
    double radius,
  ) {
    final type = block['type']?.toString();
    final props = block['props'] is Map
        ? (block['props'] as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    switch (type) {
      case 'heading':
        return Text(
          _interpolate(props['text']),
          textAlign: _alignment(props['align']),
          style: Theme.of(context).textTheme.headlineMedium,
        );
      case 'text':
      case 'legal':
        return Text(
          _interpolate(props['text']),
          textAlign: _alignment(props['align']),
          style: type == 'legal' ? Theme.of(context).textTheme.bodySmall : null,
        );
      case 'image':
        final url = props['url']?.toString() ?? '';
        return url.isEmpty
            ? const SizedBox.shrink()
            : ClipRRect(
                borderRadius: BorderRadius.circular(radius),
                child: Image.network(
                  url,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              );
      case 'benefits':
        final items = props['items'] is List
            ? props['items'] as List
            : const [];
        return Column(
          children: [
            for (final item in items)
              ListTile(
                dense: true,
                leading: Icon(Icons.check_circle, color: accent),
                title: Text(item.toString()),
              ),
          ],
        );
      case 'button':
        final action = props['action']?.toString() ?? 'next';
        final callback = switch (action) {
          'skip' || 'dismiss' => _skip,
          'complete' => _complete,
          _ => _next,
        };
        return FilledButton(
          onPressed: _savingMarketingConsent ? null : callback,
          style: FilledButton.styleFrom(
            backgroundColor: accent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radius),
            ),
          ),
          child: Text(props['text']?.toString() ?? 'Continue'),
        );
      case 'question':
        final attribute =
            props['attribute']?.toString() ?? block['id'].toString();
        final options = props['options'] is List
            ? (props['options'] as List).whereType<Map>().toList()
            : <Map>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _interpolate(props['text']),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            for (final option in options)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    backgroundColor: _answers[attribute] == option['value']
                        ? accent.withValues(alpha: 0.12)
                        : null,
                  ),
                  onPressed: () {
                    setState(() {
                      _answers[attribute] = option['value'].toString();
                      _questionError = null;
                    });
                    widget.onAnswersChanged?.call(
                      Map<String, String>.unmodifiable(_answers),
                    );
                    unawaited(_persistProgress());
                  },
                  child: Text(
                    option['label']?.toString() ?? option['value'].toString(),
                  ),
                ),
              ),
          ],
        );
      case 'marketing_consent':
        final blockKey = _marketingConsentBlockKey(block, blockIndex);
        return CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _marketingConsents[blockKey] ?? false,
          onChanged: _savingMarketingConsent
              ? null
              : (value) {
                  setState(() {
                    _marketingConsents[blockKey] = value ?? false;
                    _marketingConsentError = null;
                  });
                },
          title: Text(
            props['title']?.toString() ?? 'Receive product news and offers',
          ),
          subtitle: props['body']?.toString().trim().isNotEmpty == true
              ? Text(props['body'].toString())
              : null,
        );
      case 'spacer':
        return SizedBox(height: (props['height'] as num?)?.toDouble() ?? 24);
      case 'close':
        return Align(
          alignment: AlignmentDirectional.centerEnd,
          child: IconButton(onPressed: _close, icon: const Icon(Icons.close)),
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

Color _color(String? raw, Color fallback) {
  if (raw == null) return fallback;
  final hex = raw.replaceFirst('#', '');
  final value = int.tryParse(hex.length == 6 ? 'FF$hex' : hex, radix: 16);
  return value == null ? fallback : Color(value);
}

TextAlign _alignment(Object? value) => switch (value?.toString()) {
  'left' => TextAlign.left,
  'right' => TextAlign.right,
  _ => TextAlign.center,
};
