import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:opengrow_flutter/opengrow.dart';

class OpenGrowPaywall extends StatefulWidget {
  const OpenGrowPaywall({
    super.key,
    this.width,
    this.height,
    this.placement = 'default',
    this.offeringIdentifier,
    this.title = 'Go Premium',
    this.subtitle = 'Unlock every feature.',
    this.purchaseLabel = 'Continue',
    this.restoreLabel = 'Restore purchases',
    this.accentColor = const Color(0xFF5B5FF0),
    this.onPurchased,
    this.onRestored,
    this.onClosed,
  });

  final double? width;
  final double? height;
  final String placement;
  final String? offeringIdentifier;
  final String title;
  final String subtitle;
  final String purchaseLabel;
  final String restoreLabel;
  final Color accentColor;
  final VoidCallback? onPurchased;
  final VoidCallback? onRestored;
  final VoidCallback? onClosed;

  @override
  State<OpenGrowPaywall> createState() => _OpenGrowPaywallState();
}

class _OpenGrowPaywallState extends State<OpenGrowPaywall> {
  final String _sessionId =
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${Random.secure().nextInt(0x7fffffff).toRadixString(36)}';
  OpenGrowPurchaseConfiguration? _configuration;
  OpenGrowOffering? _offering;
  OpenGrowPackage? _selected;
  String? _error;
  bool _busy = false;
  bool _closedTracked = false;

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
      final configuration = await OpenGrowPurchases.instance
          .getPurchaseConfiguration(placement: widget.placement);
      final value = widget.offeringIdentifier == null
          ? configuration.offering
          : configuration.offerings.all[widget.offeringIdentifier];
      if (!mounted) return;
      setState(() {
        _configuration = configuration;
        _offering = value;
        _selected = value?.packages.firstOrNull;
        _error = value == null ? 'No offering is available.' : null;
      });
      unawaited(
        OpenGrowPurchases.instance.trackPaywallEvent(
          'impression',
          configuration: configuration,
          metadata: _eventMetadata(),
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  void _selectPackage(OpenGrowPackage package) {
    setState(() => _selected = package);
    final configuration = _configuration;
    if (configuration != null) {
      unawaited(
        OpenGrowPurchases.instance.trackPaywallEvent(
          'package_selected',
          configuration: configuration,
          packageIdentifier: package.identifier,
          metadata: _eventMetadata(),
        ),
      );
    }
  }

  Future<void> _purchase() async {
    final package = _selected;
    if (package == null || _busy) return;
    setState(() => _busy = true);
    final configuration = _configuration;
    if (configuration != null) {
      await OpenGrowPurchases.instance.trackPaywallEvent(
        'purchase_started',
        configuration: configuration,
        packageIdentifier: package.identifier,
        metadata: _eventMetadata(),
      );
    }
    final result = await OpenGrowPurchases.instance.purchasePackage(package);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = result.outcome == OpenGrowPurchaseOutcome.failed
          ? result.error
          : null;
    });
    if (configuration != null) {
      final type = switch (result.outcome) {
        OpenGrowPurchaseOutcome.purchased => 'purchase_succeeded',
        OpenGrowPurchaseOutcome.cancelled => 'purchase_cancelled',
        OpenGrowPurchaseOutcome.failed => 'purchase_failed',
        OpenGrowPurchaseOutcome.pending => 'purchase_started',
      };
      unawaited(
        OpenGrowPurchases.instance.trackPaywallEvent(
          type,
          configuration: configuration,
          packageIdentifier: package.identifier,
          metadata: _eventMetadata({
            if (result.error != null) 'error': result.error,
          }),
        ),
      );
    }
    if (result.outcome == OpenGrowPurchaseOutcome.purchased) {
      widget.onPurchased?.call();
    }
  }

  Future<void> _restore() async {
    if (_busy) return;
    setState(() => _busy = true);
    final configuration = _configuration;
    if (configuration != null) {
      await OpenGrowPurchases.instance.trackPaywallEvent(
        'restore_started',
        configuration: configuration,
        metadata: _eventMetadata(),
      );
    }
    try {
      await OpenGrowPurchases.instance.restorePurchases();
      if (configuration != null) {
        unawaited(
          OpenGrowPurchases.instance.trackPaywallEvent(
            'restore_succeeded',
            configuration: configuration,
            metadata: _eventMetadata(),
          ),
        );
      }
      widget.onRestored?.call();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
      if (configuration != null) {
        unawaited(
          OpenGrowPurchases.instance.trackPaywallEvent(
            'restore_failed',
            configuration: configuration,
            metadata: _eventMetadata({'error': error.toString()}),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _close() {
    _closedTracked = true;
    final configuration = _configuration;
    if (configuration != null) {
      unawaited(
        OpenGrowPurchases.instance.trackPaywallEvent(
          'closed',
          configuration: configuration,
          packageIdentifier: _selected?.identifier,
          metadata: _eventMetadata(),
        ),
      );
    }
    widget.onClosed?.call();
  }

  @override
  void dispose() {
    final configuration = _configuration;
    if (!_closedTracked && configuration != null) {
      _closedTracked = true;
      unawaited(
        OpenGrowPurchases.instance.trackPaywallEvent(
          'closed',
          configuration: configuration,
          packageIdentifier: _selected?.identifier,
          metadata: _eventMetadata({'source': 'widget_disposed'}),
        ),
      );
    }
    super.dispose();
  }

  List<Map<String, dynamic>> get _components {
    final value = _configuration?.paywall?.configuration['components'];
    if (value is List) {
      return value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
    }
    return [
      {'type': 'title', 'text': widget.title},
      {'type': 'subtitle', 'text': widget.subtitle},
      {'type': 'packages'},
      {'type': 'purchase_button', 'text': widget.purchaseLabel},
      {'type': 'restore_button', 'text': widget.restoreLabel},
    ];
  }

  Color get _accentColor {
    final theme = _configuration?.paywall?.configuration['theme'];
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
    switch (type) {
      case 'title':
        return Text(
          component['text']?.toString() ?? widget.title,
          style: Theme.of(context).textTheme.headlineMedium,
          textAlign: TextAlign.center,
        );
      case 'subtitle':
      case 'legal':
        return Text(
          component['text']?.toString() ?? widget.subtitle,
          textAlign: TextAlign.center,
          style: type == 'legal' ? Theme.of(context).textTheme.bodySmall : null,
        );
      case 'image':
        final url = component['url']?.toString();
        return url == null || url.isEmpty
            ? const SizedBox.shrink()
            : ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(url, fit: BoxFit.cover),
              );
      case 'benefits':
        final items = component['items'] is List
            ? component['items'] as List
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
        return _packageList();
      case 'purchase_button':
        return FilledButton(
          onPressed: _selected == null || _busy ? null : _purchase,
          style: FilledButton.styleFrom(backgroundColor: _accentColor),
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(component['text']?.toString() ?? widget.purchaseLabel),
        );
      case 'restore_button':
        return TextButton(
          onPressed: _busy ? null : _restore,
          child: Text(component['text']?.toString() ?? widget.restoreLabel),
        );
      case 'close_button':
        return Align(
          alignment: Alignment.centerRight,
          child: IconButton(onPressed: _close, icon: const Icon(Icons.close)),
        );
      default:
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
            if (_offering == null && _error == null)
              const Center(child: CircularProgressIndicator()),
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
