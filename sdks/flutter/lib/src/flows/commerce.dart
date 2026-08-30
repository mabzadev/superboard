import 'package:flutter/material.dart';

import '../../models/superboard_purchases.dart';
import '../../superboard_purchases.dart';
import 'client.dart';
import 'models.dart';

/// Narrow Products boundary used by the Flows commerce component.
///
/// Implementations must return purchases already verified by Products. Flows
/// only selects the matching workflow exit and never reports revenue itself.
abstract interface class SuperBoardFlowCommerceGateway {
  Future<SuperBoardOfferings> getOfferings({required String placement});

  Future<SuperBoardPurchaseResult> purchasePackage(SuperBoardPackage package);

  Future<SuperBoardCustomerInfo> restorePurchases();
}

/// Default bridge to the native SuperBoard Products SDK.
final class SuperBoardProductsFlowCommerceGateway
    implements SuperBoardFlowCommerceGateway {
  SuperBoardProductsFlowCommerceGateway({SuperBoardPurchases? purchases})
    : _purchases = purchases ?? SuperBoardPurchases.instance;

  final SuperBoardPurchases _purchases;

  @override
  Future<SuperBoardOfferings> getOfferings({required String placement}) =>
      _purchases.getOfferings(placement: placement);

  @override
  Future<SuperBoardPurchaseResult> purchasePackage(SuperBoardPackage package) =>
      _purchases.purchasePackage(package);

  @override
  Future<SuperBoardCustomerInfo> restorePurchases() =>
      _purchases.restorePurchases();
}

/// Native renderer for the `superboard-commerce` Flow component.
///
/// Store checkout and receipt validation remain owned by
/// [SuperBoardPurchases]. The only events emitted through Flows are workflow
/// transitions, without prices or revenue, so purchase accounting cannot be
/// duplicated by Analytics or Flows.
class SuperBoardFlowCommerce extends StatefulWidget {
  const SuperBoardFlowCommerce({
    super.key,
    required this.block,
    required this.client,
    this.gateway,
  });

  final SuperBoardFlowBlock block;
  final SuperBoardFlowsClient client;
  final SuperBoardFlowCommerceGateway? gateway;

  @override
  State<SuperBoardFlowCommerce> createState() => _SuperBoardFlowCommerceState();
}

class _SuperBoardFlowCommerceState extends State<SuperBoardFlowCommerce> {
  late SuperBoardFlowCommerceGateway _gateway;
  SuperBoardOffering? _offering;
  SuperBoardPackage? _selectedPackage;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    _gateway = widget.gateway ?? SuperBoardProductsFlowCommerceGateway();
    _load();
  }

  @override
  void didUpdateWidget(SuperBoardFlowCommerce oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldState = oldWidget.block.blockStateId ?? oldWidget.block.id;
    final newState = widget.block.blockStateId ?? widget.block.id;
    if (!identical(oldWidget.gateway, widget.gateway)) {
      _gateway = widget.gateway ?? SuperBoardProductsFlowCommerceGateway();
    }
    if (oldState != newState || oldWidget.gateway != widget.gateway) {
      _load();
    }
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _finished = false;
        _error = null;
      });
    }
    try {
      final offerings = await _gateway.getOfferings(placement: _placement);
      final configured = _offeringIdentifier;
      final offering = configured == null
          ? offerings.current ?? offerings.all.values.firstOrNull
          : offerings.all[configured];
      if (!mounted) return;
      setState(() {
        _offering = offering;
        _selectedPackage = offering?.packages.firstOrNull;
        _loading = false;
        _error = offering == null
            ? configured == null
                  ? 'No offering is available.'
                  : 'Offering "$configured" is not available.'
            : offering.packages.isEmpty
            ? 'This offering has no available packages.'
            : null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  String get _placement =>
      _firstText(widget.block.resolvedData, const [
        'placement',
        'placementIdentifier',
        'placement_identifier',
      ]) ??
      _metadataText('placement') ??
      'default';

  String? get _offeringIdentifier =>
      _firstText(widget.block.resolvedData, const [
        'offeringIdentifier',
        'offering_identifier',
      ]) ??
      _metadataText('offering_identifier') ??
      _metadataText('offeringIdentifier');

  String? _metadataText(String key) {
    final metadata = widget.block.resolvedData['metadata'];
    if (metadata is! Map) return null;
    final value = metadata[key]?.toString().trim();
    return value == null || value.isEmpty ? null : value;
  }

  String get _title =>
      _firstText(widget.block.resolvedData, const ['title', 'heading']) ??
      _componentText(const ['heading', 'title']) ??
      _offering?.displayName ??
      'Unlock premium';

  String get _description =>
      _firstText(widget.block.resolvedData, const [
        'description',
        'subtitle',
        'body',
      ]) ??
      _componentText(const ['text', 'paragraph', 'subtitle']) ??
      _offering?.description ??
      '';

  String get _purchaseLabel =>
      _componentButtonLabel(const ['purchase', 'checkout']) ?? 'Continue';

  String get _restoreLabel =>
      _componentButtonLabel(const ['restore']) ?? 'Restore purchases';

  String? _componentText(List<String> types) {
    final components = widget.block.resolvedData['components'];
    if (components is! List) return null;
    for (final raw in components.whereType<Map>()) {
      if (!types.contains(raw['type']?.toString())) continue;
      final props = raw['props'];
      if (props is! Map) continue;
      final value = _firstText(props, const ['text', 'title', 'label']);
      if (value != null) return value;
    }
    return null;
  }

  String? _componentButtonLabel(List<String> actions) {
    final components = widget.block.resolvedData['components'];
    if (components is! List) return null;
    for (final raw in components.whereType<Map>()) {
      if (raw['type']?.toString() != 'button') continue;
      final props = raw['props'];
      if (props is! Map || !actions.contains(props['action']?.toString())) {
        continue;
      }
      final value = _firstText(props, const ['text', 'label']);
      if (value != null) return value;
    }
    return null;
  }

  Future<void> _purchase() async {
    final package = _selectedPackage;
    if (_busy || package == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _gateway.purchasePackage(package);
      if (!mounted) return;
      final exitNode = switch (result.outcome) {
        SuperBoardPurchaseOutcome.purchased => 'purchase',
        SuperBoardPurchaseOutcome.cancelled => 'cancel',
        SuperBoardPurchaseOutcome.pending => 'checkout',
        SuperBoardPurchaseOutcome.failed => 'error',
      };
      await widget.client.transition(
        widget.block,
        exitNode: exitNode,
        properties: {
          'authority': 'products',
          'packageIdentifier': package.identifier,
          'productIdentifier': result.productIdentifier,
          'transactionIdentifier': result.transactionIdentifier,
          'purchaseOutcome': result.outcome.name,
          if (result.code.isNotEmpty) 'code': result.code,
        },
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _finished = result.outcome != SuperBoardPurchaseOutcome.failed;
        _error = result.outcome == SuperBoardPurchaseOutcome.failed
            ? result.error ?? 'The purchase could not be completed.'
            : null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _restore() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _gateway.restorePurchases();
      await widget.client.transition(
        widget.block,
        exitNode: 'restore',
        properties: const {'authority': 'products'},
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _finished = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _dismiss() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.client.transition(widget.block, exitNode: 'dismiss');
      if (mounted) setState(() => _finished = true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_finished) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.center,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        margin: const EdgeInsets.all(20),
        child: Material(
          elevation: 12,
          borderRadius: BorderRadius.circular(20),
          color: Theme.of(context).colorScheme.surface,
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: _loading
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: CircularProgressIndicator(),
                    ),
                  )
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerRight,
                        child: IconButton(
                          tooltip: 'Close',
                          onPressed: _busy ? null : _dismiss,
                          icon: const Icon(Icons.close),
                        ),
                      ),
                      Text(
                        _title,
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      if (_description.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(_description, textAlign: TextAlign.center),
                      ],
                      const SizedBox(height: 20),
                      for (final package
                          in _offering?.packages ??
                              const <SuperBoardPackage>[]) ...[
                        _CommercePackageTile(
                          package: package,
                          selected: identical(package, _selectedPackage),
                          enabled: !_busy,
                          onSelected: () =>
                              setState(() => _selectedPackage = package),
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                      FilledButton(
                        onPressed: _busy || _selectedPackage == null
                            ? null
                            : _purchase,
                        child: _busy
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(_purchaseLabel),
                      ),
                      TextButton(
                        onPressed: _busy ? null : _restore,
                        child: Text(_restoreLabel),
                      ),
                      if (_error != null)
                        TextButton(
                          onPressed: _busy ? null : _load,
                          child: const Text('Try again'),
                        ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _CommercePackageTile extends StatelessWidget {
  const _CommercePackageTile({
    required this.package,
    required this.selected,
    required this.enabled,
    required this.onSelected,
  });

  final SuperBoardPackage package;
  final bool selected;
  final bool enabled;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    child: InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: enabled ? onSelected : null,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? Theme.of(context).colorScheme.primary
                : Theme.of(context).colorScheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Radio<bool>(
              value: true,
              // Kept for the package's Flutter >=3.3 compatibility floor.
              // ignore: deprecated_member_use
              groupValue: selected,
              // ignore: deprecated_member_use
              onChanged: enabled ? (_) => onSelected() : null,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    package.product.title ?? package.identifier,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  if ((package.product.description ?? '').isNotEmpty)
                    Text(package.product.description!),
                ],
              ),
            ),
            if ((package.product.localizedPrice ?? '').isNotEmpty)
              Text(
                package.product.localizedPrice!,
                style: Theme.of(context).textTheme.titleMedium,
              ),
          ],
        ),
      ),
    ),
  );
}

String? _firstText(Map<dynamic, dynamic> values, List<String> keys) {
  for (final key in keys) {
    final value = values[key]?.toString().trim();
    if (value != null && value.isNotEmpty) return value;
  }
  return null;
}
