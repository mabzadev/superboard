import 'package:flutter/material.dart';
import 'package:opengrow_flutter/opengrow.dart';

class OpenGrowPaywall extends StatefulWidget {
  const OpenGrowPaywall({
    super.key,
    this.width,
    this.height,
    this.offeringIdentifier,
    this.title = 'Passez Premium',
    this.subtitle = 'Débloquez toutes les fonctionnalités.',
    this.purchaseLabel = 'Continuer',
    this.restoreLabel = 'Restaurer mes achats',
    this.accentColor = const Color(0xFF5B5FF0),
    this.onPurchased,
    this.onRestored,
  });

  final double? width;
  final double? height;
  final String? offeringIdentifier;
  final String title;
  final String subtitle;
  final String purchaseLabel;
  final String restoreLabel;
  final Color accentColor;
  final VoidCallback? onPurchased;
  final VoidCallback? onRestored;

  @override
  State<OpenGrowPaywall> createState() => _OpenGrowPaywallState();
}

class _OpenGrowPaywallState extends State<OpenGrowPaywall> {
  OpenGrowOffering? _offering;
  OpenGrowPackage? _selected;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final offerings = await OpenGrowPurchases.instance.getOfferings();
      final value = widget.offeringIdentifier == null
          ? offerings.current
          : offerings.all[widget.offeringIdentifier];
      if (!mounted) return;
      setState(() {
        _offering = value;
        _selected = value?.packages.firstOrNull;
        _error = value == null ? 'Aucune offre disponible.' : null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _purchase() async {
    final package = _selected;
    if (package == null || _busy) return;
    setState(() => _busy = true);
    final result = await OpenGrowPurchases.instance.purchasePackage(package);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = result.outcome == OpenGrowPurchaseOutcome.failed
          ? result.error
          : null;
    });
    if (result.outcome == OpenGrowPurchaseOutcome.purchased)
      widget.onPurchased?.call();
  }

  Future<void> _restore() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await OpenGrowPurchases.instance.restorePurchases();
      widget.onRestored?.call();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.title,
              style: Theme.of(context).textTheme.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(widget.subtitle, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            if (_offering == null && _error == null)
              const Center(child: CircularProgressIndicator()),
            for (final package in _offering?.packages ?? const <OpenGrowPackage>[])
              Card(
                color: identical(_selected, package)
                    ? widget.accentColor.withValues(alpha: 0.12)
                    : null,
                child: ListTile(
                  onTap: _busy
                      ? null
                      : () => setState(() => _selected = package),
                  leading: Icon(
                    identical(_selected, package)
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: widget.accentColor,
                  ),
                  title: Text(package.product.title ?? package.identifier),
                  subtitle: Text(package.product.description ?? ''),
                  trailing: Text(package.product.localizedPrice ?? ''),
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                  textAlign: TextAlign.center,
                ),
              ),
            FilledButton(
              onPressed: _selected == null || _busy ? null : _purchase,
              style: FilledButton.styleFrom(
                backgroundColor: widget.accentColor,
              ),
              child: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(widget.purchaseLabel),
            ),
            TextButton(
              onPressed: _busy ? null : _restore,
              child: Text(widget.restoreLabel),
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
    this.label = 'Restaurer mes achats',
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
