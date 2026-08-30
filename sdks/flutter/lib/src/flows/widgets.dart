import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import 'client.dart';
import 'commerce.dart';
import 'models.dart';
import 'navigation.dart';

typedef SuperBoardFlowComponentBuilder =
    Widget Function(
      BuildContext context,
      SuperBoardFlowBlock block,
      SuperBoardFlowComponentController controller,
    );

typedef SuperBoardFlowExitHandler = FutureOr<void> Function(String exitNode);

class SuperBoardFlowBuilderRegistry {
  SuperBoardFlowBuilderRegistry();

  static final SuperBoardFlowBuilderRegistry instance =
      SuperBoardFlowBuilderRegistry();

  final Map<String, SuperBoardFlowComponentBuilder> _builders = {};

  void register(String componentType, SuperBoardFlowComponentBuilder builder) {
    final key = componentType.trim();
    if (key.isEmpty) {
      throw ArgumentError.value(componentType, 'componentType');
    }
    _builders[key] = builder;
  }

  void unregister(String componentType) => _builders.remove(componentType);

  SuperBoardFlowComponentBuilder? resolve(String? componentType) =>
      componentType == null ? null : _builders[componentType];

  void clear() => _builders.clear();
}

class SuperBoardFlowComponentController {
  const SuperBoardFlowComponentController({
    required this.client,
    required this.block,
    this.onComplete,
    this.onCancel,
  });

  final SuperBoardFlowsClient client;
  final SuperBoardFlowBlock block;
  final SuperBoardFlowExitHandler? onComplete;
  final SuperBoardFlowExitHandler? onCancel;

  Future<void> complete([String exitNode = 'default']) async {
    final handler = onComplete;
    if (handler != null) {
      await handler(exitNode);
      return;
    }
    await client.transition(block, exitNode: exitNode);
  }

  Future<void> cancel([String exitNode = 'close']) async {
    final handler = onCancel;
    if (handler != null) {
      await handler(exitNode);
      return;
    }
    await client.transition(block, exitNode: exitNode);
  }

  Future<void> setStateMemory(String propertyKey, Object? value) =>
      client.setStateMemory(block, propertyKey, value);

  Future<void> performAction(Object? rawAction) async {
    if (rawAction is! Map) return;
    final action = rawAction.map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final target = action['url']?.toString();
    if (target != null && target.isNotEmpty) await client.navigate(target);
    final exitNode = action['exitNode']?.toString();
    if (exitNode != null && exitNode.isNotEmpty) await complete(exitNode);
  }
}

class SuperBoardFlowsOverlay extends StatefulWidget {
  const SuperBoardFlowsOverlay({
    super.key,
    required this.child,
    this.client,
    this.registry,
    this.anchorController,
    this.showDebugOverlay,
  });

  final Widget child;
  final SuperBoardFlowsClient? client;
  final SuperBoardFlowBuilderRegistry? registry;
  final SuperBoardFlowAnchorController? anchorController;
  final bool? showDebugOverlay;

  @override
  State<SuperBoardFlowsOverlay> createState() => _SuperBoardFlowsOverlayState();
}

class _SuperBoardFlowsOverlayState extends State<SuperBoardFlowsOverlay> {
  StreamSubscription<List<SuperBoardFlowBlock>>? _subscription;
  late SuperBoardFlowsClient _client;
  List<SuperBoardFlowBlock> _blocks = const [];

  @override
  void initState() {
    super.initState();
    _attach();
  }

  @override
  void didUpdateWidget(SuperBoardFlowsOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.client, widget.client)) _attach();
  }

  void _attach() {
    unawaited(_subscription?.cancel());
    _client = widget.client ?? SuperBoardFlows.instance;
    _blocks = _client.floatingBlocks;
    _subscription = _client.floatingBlocksStream.listen((blocks) {
      if (mounted) setState(() => _blocks = blocks);
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      widget.child,
      for (final block in _blocks)
        SuperBoardFlowRenderer(
          key: ValueKey(block.blockStateId ?? block.id),
          block: block,
          client: _client,
          registry: widget.registry,
          anchorController: widget.anchorController,
        ),
      if (widget.showDebugOverlay ?? _client.debug)
        SuperBoardFlowsDebugOverlay(client: _client),
    ],
  );
}

class SuperBoardFlowsSlot extends StatefulWidget {
  const SuperBoardFlowsSlot({
    super.key,
    required this.slotId,
    this.client,
    this.registry,
    this.empty = const SizedBox.shrink(),
    this.spacing = 12,
  });

  final String slotId;
  final SuperBoardFlowsClient? client;
  final SuperBoardFlowBuilderRegistry? registry;
  final Widget empty;
  final double spacing;

  @override
  State<SuperBoardFlowsSlot> createState() => _SuperBoardFlowsSlotState();
}

class _SuperBoardFlowsSlotState extends State<SuperBoardFlowsSlot> {
  StreamSubscription<List<SuperBoardFlowBlock>>? _subscription;
  late SuperBoardFlowsClient _client;
  List<SuperBoardFlowBlock> _blocks = const [];

  @override
  void initState() {
    super.initState();
    _attach();
  }

  @override
  void didUpdateWidget(SuperBoardFlowsSlot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.client, widget.client) ||
        oldWidget.slotId != widget.slotId) {
      _attach();
    }
  }

  void _attach() {
    unawaited(_subscription?.cancel());
    _client = widget.client ?? SuperBoardFlows.instance;
    _blocks = _client.slotBlocks(widget.slotId);
    _subscription = _client.slotBlocksStream(widget.slotId).listen((blocks) {
      if (mounted) setState(() => _blocks = blocks);
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_blocks.isEmpty) return widget.empty;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < _blocks.length; index++) ...[
          if (index > 0) SizedBox(height: widget.spacing),
          SuperBoardFlowRenderer(
            key: ValueKey(_blocks[index].blockStateId ?? _blocks[index].id),
            block: _blocks[index],
            client: _client,
            registry: widget.registry,
          ),
        ],
      ],
    );
  }
}

class SuperBoardFlowRenderer extends StatefulWidget {
  const SuperBoardFlowRenderer({
    super.key,
    required this.block,
    required this.client,
    this.registry,
    this.anchorController,
    this.controller,
    this.activateOnRender = true,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowsClient client;
  final SuperBoardFlowBuilderRegistry? registry;
  final SuperBoardFlowAnchorController? anchorController;
  final SuperBoardFlowComponentController? controller;
  final bool activateOnRender;

  @override
  State<SuperBoardFlowRenderer> createState() => _SuperBoardFlowRendererState();
}

class _SuperBoardFlowRendererState extends State<SuperBoardFlowRenderer> {
  String? _activatedState;
  StreamSubscription<String>? _anchorSubscription;

  @override
  void initState() {
    super.initState();
    _attachAnchors();
    _activateAfterLayout();
  }

  @override
  void didUpdateWidget(SuperBoardFlowRenderer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.anchorController, widget.anchorController)) {
      _attachAnchors();
    }
    _activateAfterLayout();
  }

  void _attachAnchors() {
    unawaited(_anchorSubscription?.cancel());
    final anchors = widget.anchorController ?? SuperBoardFlowAnchors.instance;
    _anchorSubscription = anchors.changes.listen((_) {
      if (!mounted) return;
      setState(() {});
      _activateAfterLayout();
    });
  }

  @override
  void dispose() {
    _anchorSubscription?.cancel();
    super.dispose();
  }

  void _activateAfterLayout() {
    if (!widget.activateOnRender) return;
    final triggerExpressions = widget.block.tourTrigger?['\$and'];
    if ((widget.block.type == SuperBoardFlowBlockType.tour ||
            widget.block.type == SuperBoardFlowBlockType.survey) &&
        triggerExpressions is List &&
        triggerExpressions.isNotEmpty) {
      return;
    }
    final state = widget.block.blockStateId ?? widget.block.id;
    if (_activatedState == state) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _activatedState == state || !_canActivate()) return;
      _activatedState = state;
      _ignoreFlowFuture(widget.client.activateBlock(widget.block));
    });
  }

  bool _canActivate() {
    if (!widget.activateOnRender) return false;
    if (!const {
      'BasicsV2Hint',
      'BasicsV2Tooltip',
    }.contains(widget.block.componentType)) {
      return true;
    }
    final target = _text(widget.block.resolvedData, 'targetElement');
    if (target.isEmpty) return true;
    final anchors = widget.anchorController ?? SuperBoardFlowAnchors.instance;
    return anchors.rectFor(target) != null;
  }

  @override
  Widget build(BuildContext context) {
    final block = widget.block;
    final controller =
        widget.controller ??
        SuperBoardFlowComponentController(client: widget.client, block: block);
    final custom = (widget.registry ?? SuperBoardFlowBuilderRegistry.instance)
        .resolve(block.componentType);
    if (custom != null) return custom(context, block, controller);
    if (block.type == SuperBoardFlowBlockType.survey) {
      return _SuperBoardTriggeredSurveyView(
        block: block,
        controller: controller,
        anchorController: widget.anchorController,
      );
    }
    if (block.type == SuperBoardFlowBlockType.tour &&
        block.tourBlocks.isNotEmpty) {
      return _SuperBoardFlowTourView(
        block: block,
        client: widget.client,
        registry: widget.registry,
        anchorController: widget.anchorController,
      );
    }
    return switch (block.componentType) {
      'superboard-commerce' => SuperBoardFlowCommerce(
        block: block,
        client: widget.client,
      ),
      'BasicsV2FloatingChecklist' => SuperBoardFlowFloatingChecklist(
        block: block,
        controller: controller,
      ),
      'BasicsV2Hint' => SuperBoardFlowHint(
        block: block,
        controller: controller,
        anchorController: widget.anchorController,
      ),
      'BasicsV2Modal' => SuperBoardFlowModal(
        block: block,
        controller: controller,
      ),
      'BasicsV2Tooltip' => SuperBoardFlowTooltip(
        block: block,
        controller: controller,
        anchorController: widget.anchorController,
      ),
      _ => SuperBoardFlowCard(block: block, controller: controller),
    };
  }
}

class SuperBoardFlowCard extends StatelessWidget {
  const SuperBoardFlowCard({
    super.key,
    required this.block,
    required this.controller,
    this.margin = const EdgeInsets.all(16),
    this.alignment = Alignment.center,
    this.maxWidth = 520,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;
  final EdgeInsets margin;
  final Alignment alignment;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final data = block.resolvedData;
    return Align(
      alignment: alignment,
      child: Container(
        constraints: BoxConstraints(maxWidth: maxWidth),
        margin: margin,
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(16),
          color: Theme.of(context).colorScheme.surface,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _DismissButton(block: block, controller: controller),
                if (_text(data, 'title').isNotEmpty)
                  Text(
                    _text(data, 'title'),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                if (_text(data, 'body').isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(_stripHtml(_text(data, 'body'))),
                ],
                _ActionRow(data: data, controller: controller),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SuperBoardFlowModal extends StatelessWidget {
  const SuperBoardFlowModal({
    super.key,
    required this.block,
    required this.controller,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;

  @override
  Widget build(BuildContext context) {
    final data = block.resolvedData;
    final position = _text(data, 'position');
    final size = _text(data, 'size');
    return Positioned.fill(
      child: Material(
        color: data['hideOverlay'] == true
            ? Colors.transparent
            : Colors.black54,
        child: SuperBoardFlowCard(
          block: block,
          controller: controller,
          margin: const EdgeInsets.all(24),
          alignment: _modalAlignment(position),
          maxWidth: size == 'small' ? 360 : 520,
        ),
      ),
    );
  }
}

class SuperBoardFlowHint extends StatefulWidget {
  const SuperBoardFlowHint({
    super.key,
    required this.block,
    required this.controller,
    this.anchorController,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;
  final SuperBoardFlowAnchorController? anchorController;

  @override
  State<SuperBoardFlowHint> createState() => _SuperBoardFlowHintState();
}

class _SuperBoardFlowHintState extends State<SuperBoardFlowHint> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final data = widget.block.resolvedData;
    final anchor = _text(data, 'targetElement');
    final rect = (widget.anchorController ?? SuperBoardFlowAnchors.instance)
        .rectFor(anchor);
    if (rect == null) {
      if (anchor.isNotEmpty) return const SizedBox.shrink();
      return Align(
        alignment: Alignment.bottomRight,
        child: SuperBoardFlowCard(
          block: widget.block,
          controller: widget.controller,
        ),
      );
    }
    final availableWidth = MediaQuery.sizeOf(context).width;
    final cardLeft = rect.left
        .clamp(8.0, max(8.0, availableWidth - 340))
        .toDouble();
    return Stack(
      fit: StackFit.expand,
      children: [
        Positioned(
          left: rect.center.dx - 14,
          top: rect.center.dy - 14,
          child: Semantics(
            label: _text(data, 'title'),
            button: true,
            child: IconButton.filled(
              onPressed: () => setState(() => _open = !_open),
              icon: const Icon(Icons.lightbulb_outline),
            ),
          ),
        ),
        if (_open)
          Positioned(
            left: cardLeft,
            top: rect.bottom + 8,
            width: 332,
            child: SuperBoardFlowCard(
              block: widget.block,
              controller: widget.controller,
              margin: EdgeInsets.zero,
            ),
          ),
      ],
    );
  }
}

class SuperBoardFlowTooltip extends StatelessWidget {
  const SuperBoardFlowTooltip({
    super.key,
    required this.block,
    required this.controller,
    this.anchorController,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;
  final SuperBoardFlowAnchorController? anchorController;

  @override
  Widget build(BuildContext context) {
    final anchor = _text(block.resolvedData, 'targetElement');
    final rect = (anchorController ?? SuperBoardFlowAnchors.instance).rectFor(
      anchor,
    );
    if (rect == null) {
      if (anchor.isNotEmpty) return const SizedBox.shrink();
      return SuperBoardFlowCard(block: block, controller: controller);
    }
    return Positioned(
      left: rect.left,
      top: rect.bottom + 8,
      width: 320,
      child: SuperBoardFlowCard(
        block: block,
        controller: controller,
        margin: EdgeInsets.zero,
      ),
    );
  }
}

class SuperBoardFlowFloatingChecklist extends StatefulWidget {
  const SuperBoardFlowFloatingChecklist({
    super.key,
    required this.block,
    required this.controller,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;

  @override
  State<SuperBoardFlowFloatingChecklist> createState() =>
      _SuperBoardFlowFloatingChecklistState();
}

class _SuperBoardFlowFloatingChecklistState
    extends State<SuperBoardFlowFloatingChecklist> {
  late bool _open = widget.block.resolvedData['defaultOpen'] == true;
  late final Set<int> _completed = _completedFromBlock();
  int? _expandedIndex;

  Set<int> _completedFromBlock() {
    final items = widget.block.resolvedData['items'];
    if (items is! List) return {};
    return {
      for (var index = 0; index < items.length; index += 1)
        if (items[index] is Map &&
            ((items[index] as Map)['completed'] == true ||
                ((items[index] as Map)['completed'] is Map &&
                    ((items[index] as Map)['completed'] as Map)['value'] ==
                        true)))
          index,
    };
  }

  @override
  void didUpdateWidget(SuperBoardFlowFloatingChecklist oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.block, widget.block)) {
      _completed
        ..clear()
        ..addAll(_completedFromBlock());
    }
  }

  bool _manualCompletion(int index) {
    final key = 'items.$index.completed';
    for (final property in widget.block.propertyMeta) {
      if (property.key != key || property.type != 'state-memory') continue;
      return property.triggers.length == 1 &&
          property.triggers.single['type'] == 'manual';
    }
    return false;
  }

  Future<void> _setCompleted(int index, bool completed) async {
    if (mounted) {
      setState(() {
        completed ? _completed.add(index) : _completed.remove(index);
        if (completed && _expandedIndex == index) _expandedIndex = null;
        if (completed &&
            widget.block.resolvedData['openOnItemCompleted'] == true) {
          _open = true;
        }
      });
    }
    await widget.controller.setStateMemory('items.$index.completed', completed);
  }

  Future<void> _itemAction(
    int index,
    Object? action, {
    required bool primary,
  }) async {
    if (primary && _manualCompletion(index)) {
      await _setCompleted(index, true);
    }
    if (widget.block.resolvedData['hideOnClick'] == true && mounted) {
      setState(() => _open = false);
    }
    await widget.controller.performAction(action);
  }

  Widget _actionButton(
    Object? raw, {
    required VoidCallback onPressed,
    required bool primary,
  }) {
    if (raw is! Map) return const SizedBox.shrink();
    final label = raw['label']?.toString() ?? '';
    if (label.isEmpty) return const SizedBox.shrink();
    return primary
        ? FilledButton(onPressed: onPressed, child: Text(label))
        : OutlinedButton(onPressed: onPressed, child: Text(label));
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.block.resolvedData;
    final items = data['items'] is List
        ? (data['items'] as List).whereType<Map>().toList()
        : const <Map>[];
    final allCompleted = items.isNotEmpty && _completed.length == items.length;
    return Align(
      alignment: _checklistAlignment(_text(data, 'position')),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: _open
                ? Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _text(data, 'popupTitle').isEmpty
                                    ? 'Checklist'
                                    : _text(data, 'popupTitle'),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                            ),
                            IconButton(
                              onPressed: () => setState(() => _open = false),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                        if (_text(data, 'popupDescription').isNotEmpty) ...[
                          Text(_stripHtml(_text(data, 'popupDescription'))),
                          const SizedBox(height: 12),
                        ],
                        if (items.isNotEmpty) ...[
                          LinearProgressIndicator(
                            value: _completed.length / items.length,
                          ),
                          const SizedBox(height: 8),
                        ],
                        if (!allCompleted)
                          for (var index = 0; index < items.length; index++)
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: Icon(
                                    _completed.contains(index)
                                        ? Icons.check_circle
                                        : Icons.radio_button_unchecked,
                                    color: _completed.contains(index)
                                        ? Theme.of(context).colorScheme.primary
                                        : null,
                                  ),
                                  title: Text(
                                    items[index]['title']?.toString() ??
                                        'Item ${index + 1}',
                                  ),
                                  trailing: Icon(
                                    _expandedIndex == index
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                  ),
                                  onTap: () => setState(() {
                                    _expandedIndex = _expandedIndex == index
                                        ? null
                                        : index;
                                  }),
                                ),
                                if (_expandedIndex == index)
                                  Padding(
                                    padding: const EdgeInsets.only(
                                      left: 40,
                                      bottom: 10,
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        if (items[index]['description'] != null)
                                          Text(
                                            _stripHtml(
                                              items[index]['description']
                                                  .toString(),
                                            ),
                                          ),
                                        const SizedBox(height: 8),
                                        Wrap(
                                          spacing: 8,
                                          runSpacing: 8,
                                          children: [
                                            _actionButton(
                                              items[index]['primaryButton'],
                                              primary: true,
                                              onPressed: () => _ignoreFlowFuture(
                                                _itemAction(
                                                  index,
                                                  items[index]['primaryButton'],
                                                  primary: true,
                                                ),
                                              ),
                                            ),
                                            _actionButton(
                                              items[index]['secondaryButton'],
                                              primary: false,
                                              onPressed: () => _ignoreFlowFuture(
                                                _itemAction(
                                                  index,
                                                  items[index]['secondaryButton'],
                                                  primary: false,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                        if (!allCompleted && data['skipButton'] is Map)
                          Align(
                            alignment: Alignment.center,
                            child: TextButton(
                              onPressed: () => _ignoreFlowFuture(
                                widget.controller.performAction(
                                  data['skipButton'],
                                ),
                              ),
                              child: Text(
                                (data['skipButton'] as Map)['label']
                                        ?.toString() ??
                                    'Skip',
                              ),
                            ),
                          ),
                        if (allCompleted) ...[
                          const Icon(Icons.task_alt, size: 42),
                          const SizedBox(height: 8),
                          Text(
                            _text(data, 'completedTitle').isEmpty
                                ? 'Completed'
                                : _text(data, 'completedTitle'),
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          if (_text(data, 'completedDescription').isNotEmpty)
                            Text(
                              _stripHtml(_text(data, 'completedDescription')),
                            ),
                          if (data['completedButton'] is Map) ...[
                            const SizedBox(height: 12),
                            _actionButton(
                              data['completedButton'],
                              primary: true,
                              onPressed: () => _ignoreFlowFuture(
                                widget.controller.performAction(
                                  data['completedButton'],
                                ),
                              ),
                            ),
                          ],
                        ],
                      ],
                    ),
                  )
                : TextButton.icon(
                    onPressed: () => setState(() => _open = true),
                    icon: const Icon(Icons.checklist),
                    label: Text(
                      _text(data, 'widgetTitle').isEmpty
                          ? 'Checklist'
                          : _text(data, 'widgetTitle'),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class SuperBoardFlowSurveyView extends StatefulWidget {
  const SuperBoardFlowSurveyView({
    super.key,
    required this.block,
    required this.controller,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;

  @override
  State<SuperBoardFlowSurveyView> createState() =>
      _SuperBoardFlowSurveyViewState();
}

class _SuperBoardFlowSurveyViewState extends State<SuperBoardFlowSurveyView> {
  final Map<String, TextEditingController> _texts = {};
  final Map<String, Set<String>> _selections = {};
  final Map<String, double> _ratings = {};
  final Map<String, List<SuperBoardFlowSurveyOption>> _optionOrder = {};
  final Set<String> _otherSelections = {};
  final Set<String> _clickedLinks = {};
  int _index = 0;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in _texts.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final questions = widget.block.survey?.questions ?? const [];
    if (questions.isEmpty) return const SizedBox.shrink();
    final question = questions[_index.clamp(0, questions.length - 1)];
    return Align(
      alignment: Alignment.bottomRight,
      child: Container(
        width: 380,
        margin: const EdgeInsets.all(16),
        child: Material(
          elevation: 10,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  question.title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (question.description != null) ...[
                  const SizedBox(height: 6),
                  Text(question.description!),
                ],
                const SizedBox(height: 16),
                _questionInput(question),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (_index > 0)
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() => _index -= 1),
                        child: const Text('Back'),
                      ),
                    const Spacer(),
                    FilledButton(
                      onPressed: _busy ? null : () => _next(questions),
                      child: _busy
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(
                              _index == questions.length - 1
                                  ? 'Submit'
                                  : 'Next',
                            ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _questionInput(SuperBoardFlowSurveyQuestion question) =>
      switch (question.type) {
        'rating' => _ratingInput(question),
        'single-choice' => _singleChoiceInput(question),
        'multiple-choice' => _multipleChoiceInput(question),
        'link' => OutlinedButton(
          onPressed: question.url == null
              ? null
              : () async {
                  setState(() => _clickedLinks.add(question.id));
                  await widget.controller.client.navigate(question.url!);
                },
          child: Text(question.linkLabel ?? 'Open link'),
        ),
        'end-screen' => const Icon(Icons.check_circle_outline, size: 48),
        _ => TextField(
          controller: _texts.putIfAbsent(
            question.id,
            () => TextEditingController(),
          ),
          decoration: InputDecoration(hintText: question.textPlaceholder),
          maxLines: 4,
        ),
      };

  Widget _ratingInput(SuperBoardFlowSurveyQuestion question) {
    final minimum = question.minValue?.toInt() ?? 1;
    final maximum = question.maxValue?.toInt() ?? 5;
    if (question.displayType == 'stars' || question.displayType == 'emoji') {
      return Wrap(
        spacing: 6,
        children: [
          for (var value = minimum; value <= maximum; value += 1)
            ChoiceChip(
              selected: _ratings[question.id]?.round() == value,
              label: question.displayType == 'emoji'
                  ? Text(_ratingEmoji(value, minimum, maximum))
                  : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star, size: 18),
                        Text('$value'),
                      ],
                    ),
              onSelected: (_) =>
                  setState(() => _ratings[question.id] = value.toDouble()),
            ),
        ],
      );
    }
    return Slider(
      value: _ratings[question.id] ?? minimum.toDouble(),
      min: minimum.toDouble(),
      max: maximum.toDouble(),
      divisions: max(1, maximum - minimum),
      label: (_ratings[question.id] ?? minimum).round().toString(),
      onChanged: (value) => setState(() => _ratings[question.id] = value),
    );
  }

  Widget _singleChoiceInput(SuperBoardFlowSurveyQuestion question) {
    final selected = _otherSelections.contains(question.id)
        ? '__other__'
        : _selections[question.id]?.firstOrNull;
    return Column(
      children: [
        for (final option in _options(question))
          RadioListTile<String>(
            value: option.id,
            // Kept for the package's Flutter >=3.3 compatibility floor.
            // ignore: deprecated_member_use
            groupValue: selected,
            title: Text(option.label),
            // ignore: deprecated_member_use
            onChanged: (value) => setState(() {
              _otherSelections.remove(question.id);
              _selections[question.id] = {if (value != null) value};
            }),
          ),
        if (question.otherOption) ...[
          RadioListTile<String>(
            value: '__other__',
            // ignore: deprecated_member_use
            groupValue: selected,
            title: Text(question.otherLabel ?? 'Other'),
            // ignore: deprecated_member_use
            onChanged: (_) => setState(() {
              _otherSelections.add(question.id);
              _selections[question.id] = {};
            }),
          ),
          if (_otherSelections.contains(question.id))
            TextField(
              controller: _texts.putIfAbsent(
                'other:${question.id}',
                () => TextEditingController(),
              ),
              decoration: InputDecoration(
                hintText: question.otherLabel ?? 'Other',
              ),
            ),
        ],
      ],
    );
  }

  Widget _multipleChoiceInput(SuperBoardFlowSurveyQuestion question) => Column(
    children: [
      for (final option in _options(question))
        CheckboxListTile(
          value: _selections[question.id]?.contains(option.id) ?? false,
          title: Text(option.label),
          onChanged: (selected) => setState(() {
            final values = _selections.putIfAbsent(
              question.id,
              () => <String>{},
            );
            selected == true ? values.add(option.id) : values.remove(option.id);
          }),
        ),
      if (question.otherOption) ...[
        CheckboxListTile(
          value: _otherSelections.contains(question.id),
          title: Text(question.otherLabel ?? 'Other'),
          onChanged: (selected) => setState(() {
            selected == true
                ? _otherSelections.add(question.id)
                : _otherSelections.remove(question.id);
          }),
        ),
        if (_otherSelections.contains(question.id))
          TextField(
            controller: _texts.putIfAbsent(
              'other:${question.id}',
              () => TextEditingController(),
            ),
            decoration: InputDecoration(
              hintText: question.otherLabel ?? 'Other',
            ),
          ),
      ],
    ],
  );

  List<SuperBoardFlowSurveyOption> _options(
    SuperBoardFlowSurveyQuestion question,
  ) => _optionOrder.putIfAbsent(question.id, () {
    final values = List<SuperBoardFlowSurveyOption>.of(question.options);
    if (question.shuffleOptions) {
      values.shuffle(Random(_stableStringSeed(question.id)));
    }
    return values;
  });

  Future<void> _next(List<SuperBoardFlowSurveyQuestion> questions) async {
    final question = questions[_index];
    if (!question.optional && !_answered(question)) {
      setState(() => _error = 'This question is required.');
      return;
    }
    setState(() => _error = null);
    if (_index < questions.length - 1) {
      setState(() => _index += 1);
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.controller.client.submitSurvey(
        widget.block,
        questions.map(_answer).toList(growable: false),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _answered(SuperBoardFlowSurveyQuestion question) =>
      question.type == 'end-screen' ||
      _clickedLinks.contains(question.id) ||
      (_texts[question.id]?.text.trim().isNotEmpty ?? false) ||
      (_selections[question.id]?.isNotEmpty ?? false) ||
      _otherSelections.contains(question.id) ||
      _ratings.containsKey(question.id);

  SuperBoardFlowSurveyAnswer _answer(SuperBoardFlowSurveyQuestion question) =>
      SuperBoardFlowSurveyAnswer(
        questionId: question.id,
        textResponse: question.type == 'rating'
            ? _ratings[question.id]?.round().toString()
            : _otherSelections.contains(question.id)
            ? _texts['other:${question.id}']?.text
            : _texts[question.id]?.text,
        optionIds:
            _selections[question.id]?.toList(growable: false) ?? const [],
        otherSelected: _otherSelections.contains(question.id),
        clickedLink: _clickedLinks.contains(question.id),
      );
}

class _SuperBoardTriggeredSurveyView extends StatefulWidget {
  const _SuperBoardTriggeredSurveyView({
    required this.block,
    required this.controller,
    this.anchorController,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;
  final SuperBoardFlowAnchorController? anchorController;

  @override
  State<_SuperBoardTriggeredSurveyView> createState() =>
      _SuperBoardTriggeredSurveyViewState();
}

class _SuperBoardTriggeredSurveyViewState
    extends State<_SuperBoardTriggeredSurveyView> {
  Timer? _triggerTimer;
  StreamSubscription<String>? _interactionSubscription;
  final Set<String> _interactedAnchors = {};
  late bool _triggered;
  bool _activated = false;

  SuperBoardFlowAnchorController get _anchors =>
      widget.anchorController ?? SuperBoardFlowAnchors.instance;

  @override
  void initState() {
    super.initState();
    _triggered =
        widget.controller.client.surveyStarted(widget.block) ||
        _triggerMatches();
    _interactionSubscription = _anchors.interactions.listen(_onInteraction);
    if (_triggered) {
      _activate();
    } else {
      _scheduleTriggerCheck();
    }
  }

  @override
  void didUpdateWidget(_SuperBoardTriggeredSurveyView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldState = oldWidget.block.blockStateId ?? oldWidget.block.id;
    final newState = widget.block.blockStateId ?? widget.block.id;
    if (oldState != newState) {
      _activated = false;
      _interactedAnchors.clear();
      _triggered =
          widget.controller.client.surveyStarted(widget.block) ||
          _triggerMatches();
      if (_triggered) _activate();
    }
    _scheduleTriggerCheck();
  }

  @override
  void dispose() {
    _triggerTimer?.cancel();
    _interactionSubscription?.cancel();
    super.dispose();
  }

  void _scheduleTriggerCheck() {
    _triggerTimer?.cancel();
    if (_triggered) return;
    _triggerTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (_triggerMatches()) _start();
    });
  }

  void _onInteraction(String anchor) {
    _interactedAnchors.add(anchor);
    if (!_triggered && _triggerMatches()) _start();
  }

  bool _triggerMatches() => _flowTriggerMatches(
    trigger: widget.block.tourTrigger,
    currentLocation: widget.controller.client.currentLocation,
    anchors: _anchors,
    interactedAnchors: _interactedAnchors,
  );

  void _start() {
    if (_triggered) return;
    _triggerTimer?.cancel();
    if (mounted) setState(() => _triggered = true);
    _activate();
  }

  void _activate() {
    if (_activated) return;
    _activated = true;
    _ignoreFlowFuture(widget.controller.client.markSurveyStarted(widget.block));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _ignoreFlowFuture(widget.controller.client.activateBlock(widget.block));
      }
    });
  }

  @override
  Widget build(BuildContext context) => _triggered
      ? SuperBoardFlowSurveyView(
          block: widget.block,
          controller: widget.controller,
        )
      : const SizedBox.shrink();
}

class _SuperBoardFlowTourView extends StatefulWidget {
  const _SuperBoardFlowTourView({
    required this.block,
    required this.client,
    this.registry,
    this.anchorController,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowsClient client;
  final SuperBoardFlowBuilderRegistry? registry;
  final SuperBoardFlowAnchorController? anchorController;

  @override
  State<_SuperBoardFlowTourView> createState() =>
      _SuperBoardFlowTourViewState();
}

class _SuperBoardFlowTourViewState extends State<_SuperBoardFlowTourView> {
  Timer? _waitTimer;
  StreamSubscription<String>? _interactionSubscription;
  final Set<String> _interactedAnchors = {};
  late int _index = _boundedIndex();
  late bool _triggered;
  bool _activated = false;

  SuperBoardFlowAnchorController get _anchors =>
      widget.anchorController ?? SuperBoardFlowAnchors.instance;

  SuperBoardFlowBlock get _step => widget.block.tourBlocks[_index];

  @override
  void initState() {
    super.initState();
    _triggered = _triggerMatches();
    if (_triggered) _activateTour();
    _interactionSubscription = _anchors.interactions.listen(_onInteraction);
    _scheduleWaitEvaluation();
  }

  @override
  void didUpdateWidget(_SuperBoardFlowTourView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final stateChanged =
        (oldWidget.block.blockStateId ?? oldWidget.block.id) !=
        (widget.block.blockStateId ?? widget.block.id);
    if (stateChanged ||
        oldWidget.block.currentTourIndex != widget.block.currentTourIndex ||
        oldWidget.block.tourBlocks.length != widget.block.tourBlocks.length) {
      _index = _boundedIndex();
    }
    if (stateChanged) {
      _activated = false;
      _interactedAnchors.clear();
      _triggered = _triggerMatches();
      if (_triggered) _activateTour();
    }
    _scheduleWaitEvaluation();
  }

  @override
  void dispose() {
    _waitTimer?.cancel();
    _interactionSubscription?.cancel();
    super.dispose();
  }

  int _boundedIndex() => widget.client
      .tourIndex(widget.block)
      .clamp(0, widget.block.tourBlocks.length - 1);

  void _scheduleWaitEvaluation() {
    _waitTimer?.cancel();
    if (!_triggered) {
      _waitTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
        if (!_triggerMatches()) return;
        _waitTimer?.cancel();
        if (mounted) setState(() => _triggered = true);
        _activateTour();
        _scheduleWaitEvaluation();
      });
      return;
    }
    if (_step.type != SuperBoardFlowBlockType.wait) return;
    final wait = _step.tourWait ?? const <String, dynamic>{};
    final interaction = wait['interaction']?.toString();
    if (interaction == 'delay') {
      final milliseconds = (wait['ms'] as num?)?.toInt() ?? 0;
      _waitTimer = Timer(
        Duration(milliseconds: milliseconds.clamp(0, 2592000000)),
        () => _ignoreFlowFuture(_advance('delay')),
      );
      return;
    }
    _waitTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (_waitSatisfied(wait)) {
        _ignoreFlowFuture(_advance(interaction ?? 'wait'));
      }
    });
  }

  bool _waitSatisfied(Map<String, dynamic> wait) {
    final interaction = wait['interaction']?.toString();
    final element = wait['element']?.toString() ?? '';
    final pageMatches = _pageDefinitionMatches(
      widget.client.currentLocation,
      wait['page'],
    );
    if (interaction == 'dom-element') {
      return pageMatches &&
          (element.isEmpty || _anchors.rectFor(element) != null);
    }
    if (interaction == 'not-dom-element') {
      return pageMatches &&
          (element.isEmpty || _anchors.rectFor(element) == null);
    }
    if (interaction == 'navigation') {
      return pageMatches;
    }
    return false;
  }

  void _onInteraction(String anchor) {
    _interactedAnchors.add(anchor);
    if (!_triggered && _triggerMatches()) {
      if (mounted) setState(() => _triggered = true);
      _activateTour();
      _scheduleWaitEvaluation();
      return;
    }
    if (_step.type != SuperBoardFlowBlockType.wait) return;
    final wait = _step.tourWait;
    final expectedAnchor = wait?['element']?.toString() ?? '';
    if (wait?['interaction'] == 'click' &&
        expectedAnchor.isNotEmpty &&
        _anchors.matchesReference(expectedAnchor, anchor) &&
        _pageDefinitionMatches(widget.client.currentLocation, wait?['page'])) {
      _ignoreFlowFuture(_advance('click'));
    }
  }

  void _activateTour() {
    if (_activated) return;
    _activated = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _ignoreFlowFuture(widget.client.activateBlock(widget.block));
      }
    });
  }

  bool _triggerMatches() {
    if (_index > 0) return true;
    return _flowTriggerMatches(
      trigger: widget.block.tourTrigger,
      currentLocation: widget.client.currentLocation,
      anchors: _anchors,
      interactedAnchors: _interactedAnchors,
    );
  }

  Future<void> _advance(String action) async {
    _waitTimer?.cancel();
    if (_index >= widget.block.tourBlocks.length - 1) {
      await widget.client.transition(widget.block, exitNode: 'complete');
      return;
    }
    final next = _index + 1;
    await widget.client.updateTour(widget.block, index: next, action: action);
    if (!mounted) return;
    setState(() => _index = next);
    _scheduleWaitEvaluation();
  }

  Future<void> _previous() async {
    _waitTimer?.cancel();
    var previous = _index - 1;
    while (previous > 0 &&
        widget.block.tourBlocks[previous].type ==
            SuperBoardFlowBlockType.wait) {
      previous -= 1;
    }
    if (previous < 0) return;
    await widget.client.updateTour(
      widget.block,
      index: previous,
      action: 'back',
    );
    if (!mounted) return;
    setState(() => _index = previous);
    _scheduleWaitEvaluation();
  }

  Future<void> _cancel([String _ = 'cancel']) async {
    _waitTimer?.cancel();
    await widget.client.transition(widget.block, exitNode: 'cancel');
  }

  Future<void> _handleStepComplete(String exitNode) => switch (exitNode) {
    'back' || 'previous' => _previous(),
    'cancel' || 'close' || 'dismiss' => _cancel(exitNode),
    _ => _advance(exitNode),
  };

  @override
  Widget build(BuildContext context) {
    if (!_triggered) return const SizedBox.shrink();
    final step = _step;
    if (step.type == SuperBoardFlowBlockType.wait) {
      return const SizedBox.shrink();
    }
    return Stack(
      fit: StackFit.expand,
      children: [
        SuperBoardFlowRenderer(
          block: step,
          client: widget.client,
          registry: widget.registry,
          anchorController: widget.anchorController,
          activateOnRender: false,
          controller: SuperBoardFlowComponentController(
            client: widget.client,
            block: step,
            onComplete: _handleStepComplete,
            onCancel: _cancel,
          ),
        ),
        Positioned(
          left: 24,
          right: 24,
          bottom: 20,
          child: Row(
            children: [
              TextButton(
                onPressed: () => _ignoreFlowFuture(_cancel()),
                child: const Text('Cancel'),
              ),
              if (_index > 0)
                OutlinedButton(
                  onPressed: () => _ignoreFlowFuture(_previous()),
                  child: const Text('Back'),
                ),
              const Spacer(),
              Text('${_index + 1}/${widget.block.tourBlocks.length}'),
              const SizedBox(width: 12),
              FilledButton(
                onPressed: () => _ignoreFlowFuture(_advance('next')),
                child: Text(
                  _index == widget.block.tourBlocks.length - 1
                      ? 'Done'
                      : 'Next',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class SuperBoardFlowsDebugOverlay extends StatefulWidget {
  const SuperBoardFlowsDebugOverlay({super.key, required this.client});

  final SuperBoardFlowsClient client;

  @override
  State<SuperBoardFlowsDebugOverlay> createState() =>
      _SuperBoardFlowsDebugOverlayState();
}

class _SuperBoardFlowsDebugOverlayState
    extends State<SuperBoardFlowsDebugOverlay> {
  final List<String> _logs = [];
  StreamSubscription<String>? _subscription;
  bool _open = false;

  @override
  void initState() {
    super.initState();
    _subscription = widget.client.debugStream.listen((message) {
      if (!mounted) return;
      setState(() {
        _logs.add(message);
        if (_logs.length > 30) _logs.removeAt(0);
      });
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Positioned(
    left: 12,
    bottom: 12,
    child: Material(
      elevation: 12,
      borderRadius: BorderRadius.circular(12),
      child: _open
          ? SizedBox(
              width: 360,
              height: 280,
              child: Column(
                children: [
                  ListTile(
                    dense: true,
                    title: Text(
                      'Flows · ${widget.client.blocks.length} blocks',
                    ),
                    trailing: IconButton(
                      onPressed: () => setState(() => _open = false),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(10),
                      children: [
                        for (final log in _logs.reversed)
                          Text(
                            log,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            )
          : IconButton(
              tooltip: 'Open Flows debug panel',
              onPressed: () => setState(() => _open = true),
              icon: const Icon(Icons.account_tree_outlined),
            ),
    ),
  );
}

class _DismissButton extends StatelessWidget {
  const _DismissButton({required this.block, required this.controller});

  final SuperBoardFlowBlock block;
  final SuperBoardFlowComponentController controller;

  @override
  Widget build(BuildContext context) {
    if (block.resolvedData['dismissible'] != true) {
      return const SizedBox.shrink();
    }
    return Align(
      alignment: Alignment.centerRight,
      child: IconButton(
        tooltip: 'Close',
        onPressed: () => _ignoreFlowFuture(controller.cancel()),
        icon: const Icon(Icons.close),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.data, required this.controller});

  final Map<String, dynamic> data;
  final SuperBoardFlowComponentController controller;

  @override
  Widget build(BuildContext context) {
    final primary = data['primaryButton'];
    final secondary = data['secondaryButton'];
    if (primary is! Map && secondary is! Map) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          if (secondary is Map)
            OutlinedButton(
              onPressed: () =>
                  _ignoreFlowFuture(controller.performAction(secondary)),
              child: Text(secondary['label']?.toString() ?? 'Back'),
            ),
          if (primary is Map)
            FilledButton(
              onPressed: () =>
                  _ignoreFlowFuture(controller.performAction(primary)),
              child: Text(primary['label']?.toString() ?? 'Continue'),
            ),
        ],
      ),
    );
  }
}

String _text(Map<String, dynamic> data, String key) =>
    data[key]?.toString() ?? '';

String _stripHtml(String value) => value.replaceAll(RegExp(r'<[^>]+>'), '');

Alignment _modalAlignment(String value) => switch (value) {
  'top' => Alignment.topCenter,
  'bottom' => Alignment.bottomCenter,
  'left' => Alignment.centerLeft,
  'right' => Alignment.centerRight,
  'top-left' => Alignment.topLeft,
  'top-right' => Alignment.topRight,
  'bottom-left' => Alignment.bottomLeft,
  'bottom-right' => Alignment.bottomRight,
  _ => Alignment.center,
};

Alignment _checklistAlignment(String value) => switch (value) {
  'bottom-left' => Alignment.bottomLeft,
  'top-left' => Alignment.topLeft,
  'top-right' => Alignment.topRight,
  _ => Alignment.bottomRight,
};

void _ignoreFlowFuture(Future<void> future) {
  unawaited(future.catchError((Object _) {}));
}

int _stableStringSeed(String value) {
  var hash = 0x811c9dc5;
  for (final codeUnit in value.codeUnits) {
    hash ^= codeUnit;
    hash = (hash * 0x01000193) & 0x7fffffff;
  }
  return hash;
}

bool _flowTriggerMatches({
  required Map<String, dynamic>? trigger,
  required String currentLocation,
  required SuperBoardFlowAnchorController anchors,
  required Set<String> interactedAnchors,
}) {
  if (trigger == null) return true;
  final expressions = trigger['\$and'];
  if (expressions is! List) return false;
  return expressions.whereType<Map>().length == expressions.length &&
      expressions.whereType<Map>().every((raw) {
        final expression = raw.map(
          (key, value) => MapEntry(key.toString(), value),
        );
        final type = expression['type']?.toString();
        final value = expression['value']?.toString() ?? '';
        if (type == 'click') {
          return value.isEmpty ||
              interactedAnchors.any(
                (anchor) => anchors.matchesReference(value, anchor),
              );
        }
        if (type == 'dom-element') {
          return value.isEmpty || anchors.rectFor(value) != null;
        }
        if (type == 'not-dom-element') {
          return value.isEmpty || anchors.rectFor(value) == null;
        }
        if (type == 'navigation') {
          final operator = expression['operator']?.toString();
          if (operator == null || operator.isEmpty) return true;
          final values = expression['values'];
          if (values is! List) {
            return _pathnameMatches(currentLocation, operator, null);
          }
          final expected = values.map((item) => item.toString()).toList();
          if (expected.every((item) => item.isEmpty)) return true;
          return _pathnameMatches(currentLocation, operator, expected);
        }
        return false;
      });
}

bool _pageDefinitionMatches(String currentLocation, Object? rawPage) {
  if (rawPage is! Map) return true;
  final operator = rawPage['operator']?.toString();
  final rawValues = rawPage['value'];
  final values = rawValues is List
      ? rawValues.map((value) => value.toString()).toList(growable: false)
      : null;
  return _pathnameMatches(currentLocation, operator, values);
}

bool _pathnameMatches(String value, String? operator, List<String>? expected) {
  if (operator == null || operator.isEmpty || expected == null) return true;
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

String _ratingEmoji(int value, int minimum, int maximum) {
  if (maximum <= minimum) return '🙂';
  final ratio = (value - minimum) / (maximum - minimum);
  if (ratio < 0.2) return '😞';
  if (ratio < 0.4) return '🙁';
  if (ratio < 0.6) return '😐';
  if (ratio < 0.8) return '🙂';
  return '🤩';
}
