import 'dart:async';

import 'package:flutter/material.dart';

abstract interface class SuperBoardFlowNavigationAdapter {
  String get currentLocation;

  Future<void> navigate(String location);
}

class SuperBoardCallbackFlowNavigationAdapter
    implements SuperBoardFlowNavigationAdapter {
  const SuperBoardCallbackFlowNavigationAdapter({
    required String Function() location,
    required FutureOr<void> Function(String location) onNavigate,
  }) : _location = location,
       _onNavigate = onNavigate;

  final String Function() _location;
  final FutureOr<void> Function(String location) _onNavigate;

  @override
  String get currentLocation => _location();

  @override
  Future<void> navigate(String location) async => _onNavigate(location);
}

/// Navigation adapter for applications using Flutter's Navigator.
class SuperBoardNavigatorFlowAdapter
    implements SuperBoardFlowNavigationAdapter {
  SuperBoardNavigatorFlowAdapter({
    required this.navigatorKey,
    required this.location,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final String Function() location;

  @override
  String get currentLocation => location();

  @override
  Future<void> navigate(String target) async {
    await navigatorKey.currentState?.pushNamed(target);
  }
}

class SuperBoardFlowAnchorController {
  final Map<String, GlobalKey> _keys = {};
  final StreamController<String> _interactions = StreamController.broadcast(
    sync: true,
  );
  final StreamController<String> _changes = StreamController.broadcast(
    sync: true,
  );

  Stream<String> get interactions => _interactions.stream;
  Stream<String> get changes => _changes.stream;

  GlobalKey keyFor(String name) =>
      _keys.putIfAbsent(name, () => GlobalKey(debugLabel: 'flow:$name'));

  Rect? rectFor(String name) {
    for (final candidate in _anchorCandidates(name)) {
      final context = _keys[candidate]?.currentContext;
      final renderObject = context?.findRenderObject();
      if (renderObject is RenderBox && renderObject.hasSize) {
        return renderObject.localToGlobal(Offset.zero) & renderObject.size;
      }
    }
    return null;
  }

  Future<bool> reveal(String name, {double alignment = 0.5}) async {
    BuildContext? context;
    for (final candidate in _anchorCandidates(name)) {
      context = _keys[candidate]?.currentContext;
      if (context != null) break;
    }
    if (context == null) return false;
    await Scrollable.ensureVisible(
      context,
      alignment: alignment,
      duration: const Duration(milliseconds: 250),
    );
    return true;
  }

  void notifyInteraction(String name) {
    if (!_interactions.isClosed) _interactions.add(name);
  }

  bool matchesReference(String reference, String anchorName) =>
      _anchorCandidates(reference).contains(anchorName);

  void notifyLayout(String name) {
    if (!_changes.isClosed) _changes.add(name);
  }
}

/// Native replacement for DOM selectors used by web tooltips and tours.
class SuperBoardFlowAnchor extends StatefulWidget {
  const SuperBoardFlowAnchor({
    super.key,
    required this.name,
    required this.child,
    this.controller,
  });

  final String name;
  final Widget child;
  final SuperBoardFlowAnchorController? controller;

  @override
  State<SuperBoardFlowAnchor> createState() => _SuperBoardFlowAnchorState();
}

class _SuperBoardFlowAnchorState extends State<SuperBoardFlowAnchor> {
  SuperBoardFlowAnchorController get _controller =>
      widget.controller ?? SuperBoardFlowAnchors.instance;

  @override
  void initState() {
    super.initState();
    _notifyAfterLayout();
  }

  @override
  void didUpdateWidget(SuperBoardFlowAnchor oldWidget) {
    super.didUpdateWidget(oldWidget);
    _notifyAfterLayout();
  }

  void _notifyAfterLayout() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _controller.notifyLayout(widget.name);
    });
  }

  @override
  void dispose() {
    final controller = _controller;
    final name = widget.name;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      controller.notifyLayout(name);
    });
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final anchorController = _controller;
    return Listener(
      key: anchorController.keyFor(widget.name),
      onPointerUp: (_) => anchorController.notifyInteraction(widget.name),
      child: widget.child,
    );
  }
}

abstract final class SuperBoardFlowAnchors {
  static final SuperBoardFlowAnchorController instance =
      SuperBoardFlowAnchorController();
}

Iterable<String> _anchorCandidates(String value) sync* {
  yield value;
  if (value.startsWith('#') && value.length > 1) yield value.substring(1);
  final dataAttribute = RegExp(
    r'^\[data-flow-anchor=["\x27]([^"\x27]+)["\x27]\]$',
  ).firstMatch(value);
  if (dataAttribute != null) yield dataAttribute.group(1)!;
}
