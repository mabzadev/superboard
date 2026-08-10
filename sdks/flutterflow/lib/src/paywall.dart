import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:opengrow_flutter/opengrow.dart';

import 'experience_client.dart';

class OpenGrowPaywall extends StatefulWidget {
  const OpenGrowPaywall({
    super.key,
    this.width,
    this.height,
    this.placement = 'default',
    this.offeringIdentifier,
    this.customerId,
    this.locale,
    this.country,
    this.attributes = const {},
    this.title = 'Go Premium',
    this.subtitle = 'Unlock every feature.',
    this.purchaseLabel = 'Continue',
    this.restoreLabel = 'Restore purchases',
    this.accentColor = const Color(0xFF5B5FF0),
    this.onPurchased,
    this.onRestored,
    this.onClosed,
    this.onUnavailable,
    this.renderFallbackOnUnavailable = true,
    @visibleForTesting this.experienceClient,
  });

  final double? width;
  final double? height;
  final String placement;
  final String? offeringIdentifier;
  final String? customerId;
  final String? locale;
  final String? country;
  final Map<String, dynamic> attributes;
  final String title;
  final String subtitle;
  final String purchaseLabel;
  final String restoreLabel;
  final Color accentColor;
  final VoidCallback? onPurchased;
  final VoidCallback? onRestored;
  final VoidCallback? onClosed;
  final VoidCallback? onUnavailable;
  final bool renderFallbackOnUnavailable;
  final OpenGrowExperienceClient? experienceClient;

  @override
  State<OpenGrowPaywall> createState() => _OpenGrowPaywallState();
}

class _OpenGrowPaywallState extends State<OpenGrowPaywall> {
  final String _sessionId =
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${Random.secure().nextInt(0x7fffffff).toRadixString(36)}';
  OpenGrowResolvedExperience? _resolved;
  OpenGrowOffering? _offering;
  OpenGrowPackage? _selected;
  String? _error;
  bool _busy = false;
  bool _closedTracked = false;
  bool _loaded = false;

  OpenGrowExperienceClient get _client =>
      widget.experienceClient ?? OpenGrowExperienceSdk.client;

  Map<String, dynamic> _eventMetadata([
    Map<String, dynamic> extra = const {},
  ]) => {'session_id': _sessionId, ...extra};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _client.resolvePaywall(
          placement: widget.placement,
          customerId: widget.customerId,
          sessionId: _sessionId,
          locale: widget.locale,
          country: widget.country,
          attributes: widget.attributes,
        ),
        OpenGrowPurchases.instance.getOfferings(placement: widget.placement),
      ]);
      final resolved = results[0] as OpenGrowResolvedExperience?;
      final offerings = results[1] as OpenGrowOfferings;
      final configuredOffering = resolved?.definition['metadata'] is Map
          ? (resolved!.definition['metadata'] as Map)['offering_identifier']
                ?.toString()
          : null;
      final offeringIdentifier =
          widget.offeringIdentifier ?? configuredOffering;
      final value = offeringIdentifier == null
          ? offerings.current
          : offerings.all[offeringIdentifier];
      if (!mounted) return;
      setState(() {
        _resolved = resolved;
        _offering = value;
        _selected = value?.packages.firstOrNull;
        _error = resolved == null
            ? null
            : value == null
            ? 'No offering is available.'
            : null;
        _loaded = true;
      });
      if (resolved == null) {
        widget.onUnavailable?.call();
        return;
      }
      unawaited(_track('impression'));
      unawaited(_track('view'));
    } catch (error) {
      if (mounted)
        setState(() {
          _loaded = true;
          _error = error.toString();
        });
      widget.onUnavailable?.call();
    }
  }

  Future<void> _track(
    String type, {
    Map<String, dynamic> extra = const {},
    int revenueMicros = 0,
    String? currency,
  }) async {
    final resolved = _resolved;
    if (resolved == null) return;
    await _client.track(
      OpenGrowExperienceEvent(
        type: type,
        resolved: resolved,
        platform: _client.platform,
        revenueMicros: revenueMicros,
        currency: currency,
        payload: _eventMetadata(extra),
      ),
    );
  }

  void _selectPackage(OpenGrowPackage package) {
    setState(() => _selected = package);
    unawaited(
      _track(
        'cta',
        extra: {
          'action': 'package_selected',
          'package_identifier': package.identifier,
        },
      ),
    );
  }

  Future<void> _purchase() async {
    final package = _selected;
    if (package == null || _busy) return;
    setState(() => _busy = true);
    await _track('checkout', extra: {'package_identifier': package.identifier});
    final result = await OpenGrowPurchases.instance.purchasePackage(package);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = result.outcome == OpenGrowPurchaseOutcome.failed
          ? result.error
          : null;
    });
    final type = switch (result.outcome) {
      OpenGrowPurchaseOutcome.purchased => 'purchase',
      OpenGrowPurchaseOutcome.cancelled => 'cancel',
      OpenGrowPurchaseOutcome.failed => 'error',
      OpenGrowPurchaseOutcome.pending => 'checkout',
    };
    unawaited(
      _track(
        type,
        revenueMicros: result.outcome == OpenGrowPurchaseOutcome.purchased
            ? ((package.product.rawPrice ?? 0) * 1000000).round()
            : 0,
        currency: result.outcome == OpenGrowPurchaseOutcome.purchased
            ? package.product.currencyCode
            : null,
        extra: {
          'package_identifier': package.identifier,
          if (result.error != null) 'error': result.error,
        },
      ),
    );
    if (result.outcome == OpenGrowPurchaseOutcome.purchased) {
      widget.onPurchased?.call();
    }
  }

  Future<void> _restore() async {
    if (_busy) return;
    setState(() => _busy = true);
    await _track('cta', extra: {'action': 'restore_started'});
    try {
      await OpenGrowPurchases.instance.restorePurchases();
      unawaited(_track('restore'));
      widget.onRestored?.call();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
      unawaited(
        _track(
          'error',
          extra: {'action': 'restore', 'error': error.toString()},
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _close() {
    _closedTracked = true;
    unawaited(
      _track('dismiss', extra: {'package_identifier': _selected?.identifier}),
    );
    widget.onClosed?.call();
  }

  @override
  void dispose() {
    if (!_closedTracked && _resolved != null) {
      _closedTracked = true;
      unawaited(
        _track(
          'dismiss',
          extra: {
            'source': 'widget_disposed',
            'package_identifier': _selected?.identifier,
          },
        ),
      );
    }
    super.dispose();
  }

  List<Map<String, dynamic>> get _components {
    final value = _resolved?.definition['components'];
    if (value is List) {
      final components = value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
      if (components.isNotEmpty) return components;
    }
    return [
      {
        'type': 'heading',
        'props': {'text': widget.title},
      },
      {
        'type': 'text',
        'props': {'text': widget.subtitle},
      },
      {'type': 'packages'},
      {
        'type': 'button',
        'props': {'text': widget.purchaseLabel, 'action': 'purchase'},
      },
      {
        'type': 'button',
        'props': {'text': widget.restoreLabel, 'action': 'restore'},
      },
    ];
  }

  Color get _accentColor {
    final theme = _resolved?.definition['theme'];
    final raw = theme is Map ? theme['accent_color']?.toString() : null;
    if (raw != null) {
      final hex = raw.replaceFirst('#', '');
      final value = int.tryParse(hex.length == 6 ? 'FF$hex' : hex, radix: 16);
      if (value != null) return Color(value);
    }
    return widget.accentColor;
  }

  Widget _packageList() => Column(
    children: [
      for (final package in _offering?.packages ?? const <OpenGrowPackage>[])
        Card(
          color: identical(_selected, package)
              ? _accentColor.withValues(alpha: 0.12)
              : null,
          child: ListTile(
            onTap: _busy ? null : () => _selectPackage(package),
            leading: Icon(
              identical(_selected, package)
                  ? Icons.radio_button_checked
                  : Icons.radio_button_off,
              color: _accentColor,
            ),
            title: Text(package.product.title ?? package.identifier),
            subtitle: Text(package.product.description ?? ''),
            trailing: Text(package.product.localizedPrice ?? ''),
          ),
        ),
    ],
  );

  Widget _component(Map<String, dynamic> component) {
    final type = component['type']?.toString();
    final props = component['props'] is Map
        ? (component['props'] as Map).cast<String, dynamic>()
        : component;
    switch (type) {
      case 'heading':
      case 'title':
        return Text(
          props['text']?.toString() ?? widget.title,
          style: Theme.of(context).textTheme.headlineMedium,
          textAlign: TextAlign.center,
        );
      case 'text':
      case 'subtitle':
      case 'legal':
        return Text(
          props['text']?.toString() ?? widget.subtitle,
          textAlign: TextAlign.center,
          style: type == 'legal' ? Theme.of(context).textTheme.bodySmall : null,
        );
      case 'image':
        final url = props['url']?.toString();
        return url == null || url.isEmpty
            ? const SizedBox.shrink()
            : ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(url, fit: BoxFit.cover),
              );
      case 'benefits':
        final items = props['items'] is List
            ? props['items'] as List
            : const [];
        return Column(
          children: items
              .map(
                (item) => ListTile(
                  dense: true,
                  leading: Icon(Icons.check_circle, color: _accentColor),
                  title: Text(item.toString()),
                ),
              )
              .toList(),
        );
      case 'packages':
      case 'product':
        return _packageList();
      case 'button':
        final action = props['action']?.toString() ?? 'purchase';
        if (action == 'restore') {
          return TextButton(
            onPressed: _busy ? null : _restore,
            child: Text(props['text']?.toString() ?? widget.restoreLabel),
          );
        }
        if (action == 'dismiss') {
          return TextButton(
            onPressed: _close,
            child: Text(props['text']?.toString() ?? 'Not now'),
          );
        }
        return FilledButton(
          onPressed: _selected == null || _busy ? null : _purchase,
          style: FilledButton.styleFrom(backgroundColor: _accentColor),
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(props['text']?.toString() ?? widget.purchaseLabel),
        );
      case 'purchase_button':
        return FilledButton(
          onPressed: _selected == null || _busy ? null : _purchase,
          style: FilledButton.styleFrom(backgroundColor: _accentColor),
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(props['text']?.toString() ?? widget.purchaseLabel),
        );
      case 'restore_button':
        return TextButton(
          onPressed: _busy ? null : _restore,
          child: Text(props['text']?.toString() ?? widget.restoreLabel),
        );
      case 'close_button':
      case 'close':
        return Align(
          alignment: Alignment.centerRight,
          child: IconButton(onPressed: _close, icon: const Icon(Icons.close)),
        );
      default:
        if (type == 'spacer') {
          return SizedBox(height: (props['height'] as num?)?.toDouble() ?? 24);
        }
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!_loaded) const Center(child: CircularProgressIndicator()),
            if (_resolved != null ||
                (_loaded &&
                    _error == null &&
                    widget.renderFallbackOnUnavailable))
              for (final component in _components) ...[
                _component(component),
                const SizedBox(height: 12),
              ],
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
                textAlign: TextAlign.center,
              ),
          ],
        ),
      ),
    );
  }
}

class OpenGrowRestorePurchasesButton extends StatelessWidget {
  const OpenGrowRestorePurchasesButton({
    super.key,
    this.label = 'Restore purchases',
    this.onRestored,
  });
  final String label;
  final VoidCallback? onRestored;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () async {
        await OpenGrowPurchases.instance.restorePurchases();
        onRestored?.call();
      },
      child: Text(label),
    );
  }
}

class OpenGrowCustomerCenter extends StatelessWidget {
  const OpenGrowCustomerCenter({
    super.key,
    this.width,
    this.height,
    this.title = 'My purchases',
    this.onRestored,
  });

  final double? width;
  final double? height;
  final String title;
  final VoidCallback? onRestored;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: FutureBuilder<OpenGrowCustomerInfo>(
        future: OpenGrowPurchases.instance.getCustomerInfo(),
        builder: (context, snapshot) {
          if (!snapshot.hasData && snapshot.error == null) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.error != null) {
            return Center(child: Text(snapshot.error.toString()));
          }
          final info = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 16),
              for (final subscription in info.subscriptions)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.workspace_premium),
                    title: Text(subscription.identifier),
                    subtitle: Text(
                      '${subscription.store} · ${subscription.status}'
                      '${subscription.expiresAt == null ? '' : ' · ${subscription.expiresAt!.toLocal()}'}',
                    ),
                    trailing: subscription.willRenew
                        ? const Icon(Icons.autorenew)
                        : null,
                  ),
                ),
              if (info.balances.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  'Balances',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                for (final entry in info.balances.entries)
                  ListTile(
                    title: Text(entry.key),
                    trailing: Text('${entry.value}'),
                  ),
              ],
              OpenGrowRestorePurchasesButton(onRestored: onRestored),
            ],
          );
        },
      ),
    );
  }
}
