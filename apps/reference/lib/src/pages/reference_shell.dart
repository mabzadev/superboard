import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

import '../model/reference_feature.dart';
import '../services/reference_actions.dart';
import '../state/reference_state.dart';

class ReferenceShell extends StatefulWidget {
  const ReferenceShell({
    super.key,
    required this.state,
    required this.actions,
    required this.features,
  });

  final ReferenceState state;
  final ReferenceActions actions;
  final List<ReferenceFeature> features;

  @override
  State<ReferenceShell> createState() => _ReferenceShellState();
}

class _ReferenceShellState extends State<ReferenceShell> {
  int selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_refresh);
    widget.actions.initialize(widget.state);
  }

  @override
  void dispose() {
    widget.state.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final feature = widget.features[selectedIndex];
    final compact = MediaQuery.sizeOf(context).width < 900;
    final content = ReferenceFeaturePage(
      feature: feature,
      state: widget.state,
      actions: widget.actions,
    );
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('SuperBoard Reference'),
            Text(
              widget.state.configuration.revisionSummary,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Chip(
              avatar: Icon(
                widget.state.configuration.liveMode
                    ? Icons.cloud
                    : Icons.science,
                size: 16,
              ),
              label: Text(
                widget.state.configuration.liveMode ? 'LIVE' : 'DEMO',
              ),
            ),
          ),
        ],
      ),
      drawer: compact
          ? Drawer(
              child: SafeArea(
                child: _FeatureList(
                  features: widget.features,
                  selectedIndex: selectedIndex,
                  onSelected: (index) {
                    setState(() => selectedIndex = index);
                    Navigator.of(context).pop();
                  },
                ),
              ),
            )
          : null,
      body: Row(
        children: [
          if (!compact)
            SizedBox(
              width: 290,
              child: _FeatureList(
                features: widget.features,
                selectedIndex: selectedIndex,
                onSelected: (index) => setState(() => selectedIndex = index),
              ),
            ),
          if (!compact) const VerticalDivider(width: 1),
          Expanded(child: content),
        ],
      ),
    );
  }
}

class _FeatureList extends StatelessWidget {
  const _FeatureList({
    required this.features,
    required this.selectedIndex,
    required this.onSelected,
  });
  final List<ReferenceFeature> features;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) => ListView.builder(
    padding: const EdgeInsets.symmetric(vertical: 12),
    itemCount: features.length,
    itemBuilder: (context, index) => ListTile(
      selected: selectedIndex == index,
      leading: CircleAvatar(radius: 14, child: Text('${index + 1}')),
      title: Text(features[index].title),
      subtitle: Text(
        features[index].owner,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: () => onSelected(index),
    ),
  );
}

class ReferenceFeaturePage extends StatefulWidget {
  const ReferenceFeaturePage({
    super.key,
    required this.feature,
    required this.state,
    required this.actions,
  });

  final ReferenceFeature feature;
  final ReferenceState state;
  final ReferenceActions actions;

  @override
  State<ReferenceFeaturePage> createState() => _ReferenceFeaturePageState();
}

class _ReferenceFeaturePageState extends State<ReferenceFeaturePage> {
  late final TextEditingController input;
  ReferenceActionResult? result;
  bool running = false;
  bool renderLiveExperience = false;
  int liveExperienceGeneration = 0;
  Map<String, dynamic> liveExperienceInput = const {};

  @override
  void initState() {
    super.initState();
    input = TextEditingController(
      text: const JsonEncoder.withIndent(
        '  ',
      ).convert(_defaultInput(widget.feature.id)),
    );
  }

  @override
  void didUpdateWidget(covariant ReferenceFeaturePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.feature.id != widget.feature.id) {
      input.text = const JsonEncoder.withIndent(
        '  ',
      ).convert(_defaultInput(widget.feature.id));
      result = null;
      running = false;
      renderLiveExperience = false;
      liveExperienceGeneration = 0;
      liveExperienceInput = const {};
    }
  }

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  Future<void> run() async {
    Map<String, dynamic> payload;
    try {
      final decoded = jsonDecode(input.text);
      if (decoded is! Map) {
        throw const FormatException('Input must be a JSON object.');
      }
      payload = decoded.cast<String, dynamic>();
    } catch (error) {
      setState(
        () => result = ReferenceActionResult(
          success: false,
          operation: 'parseInput',
          payload: {'error': error.toString()},
        ),
      );
      return;
    }
    setState(() => running = true);
    final value = await widget.actions.execute(
      widget.feature,
      widget.state,
      input: payload,
    );
    if (mounted) {
      setState(() {
        result = value;
        running = false;
      });
    }
  }

  void renderExperience() {
    try {
      final decoded = jsonDecode(input.text);
      if (decoded is! Map) {
        throw const FormatException('Input must be a JSON object.');
      }
      setState(() {
        liveExperienceInput = decoded.cast<String, dynamic>();
        liveExperienceGeneration += 1;
        renderLiveExperience = true;
      });
    } catch (error) {
      setState(
        () => result = ReferenceActionResult(
          success: false,
          operation: 'renderExperience',
          payload: {'error': error.toString()},
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final errors = widget.state.configuration.validate();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          widget.feature.title,
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 8),
        Text(
          widget.feature.description,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 20),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Chip(
              avatar: const Icon(Icons.dns_outlined, size: 16),
              label: Text(widget.feature.owner),
            ),
            ...widget.feature.actions.map(
              (action) => Chip(label: Text(action)),
            ),
          ],
        ),
        const SizedBox(height: 24),
        if (errors.isNotEmpty)
          _MessageCard(
            title: 'Configuration incomplete',
            lines: errors,
            color: Theme.of(context).colorScheme.errorContainer,
          ),
        if (!widget.state.configuration.liveMode)
          const _MessageCard(
            title: 'Safe demo mode',
            lines: [
              'Remote writes and provider calls are disabled. Start with SUPERBOARD_LIVE_MODE=true only against the development target.',
            ],
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Reference input',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: input,
                  minLines: 5,
                  maxLines: 12,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    hintText: 'JSON object',
                  ),
                  style: const TextStyle(fontFamily: 'monospace'),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed:
                      running ||
                          (widget.state.configuration.liveMode &&
                              errors.isNotEmpty)
                      ? null
                      : run,
                  icon: running
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.play_arrow),
                  label: Text(running ? 'Running…' : 'Run reference action'),
                ),
              ],
            ),
          ),
        ),
        if (widget.state.configuration.liveMode &&
            (widget.feature.id == ReferenceFeatureId.paywall ||
                widget.feature.id == ReferenceFeatureId.onboarding))
          _liveExperienceCard(context),
        if (result != null)
          Card(
            color: result!.success
                ? null
                : Theme.of(context).colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: SelectableText(
                const JsonEncoder.withIndent('  ').convert(result!.toJson()),
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Application state touched',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                ...widget.feature.stateKeys.map((key) => Text('• $key')),
              ],
            ),
          ),
        ),
        if (widget.feature.id == ReferenceFeatureId.diagnostics)
          _Diagnostics(state: widget.state),
      ],
    );
  }

  Widget _liveExperienceCard(BuildContext context) {
    final placement = liveExperienceInput['placement']?.toString().trim() ?? '';
    final resolvedPlacement = placement.isEmpty
        ? widget.feature.id == ReferenceFeatureId.paywall
              ? 'default'
              : 'app_launch'
        : placement;
    final locale = liveExperienceInput['locale']?.toString().trim();
    final rawAttributes = liveExperienceInput['attributes'];
    final attributes = rawAttributes is Map
        ? rawAttributes.cast<String, dynamic>()
        : const <String, dynamic>{};
    final customerId = widget.state.currentUserId.isEmpty
        ? null
        : widget.state.currentUserId;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Live widget acceptance',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Initialize Bootstrap first, then render the real versioned widget against the development project.',
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: renderExperience,
              icon: const Icon(Icons.refresh),
              label: Text(
                renderLiveExperience
                    ? 'Reload live widget'
                    : 'Render live widget',
              ),
            ),
            if (renderLiveExperience) ...[
              const SizedBox(height: 16),
              SizedBox(
                height: 640,
                child: widget.feature.id == ReferenceFeatureId.paywall
                    // The reference keeps this released widget covered until
                    // its coordinated Flow replacement is published.
                    // ignore: deprecated_member_use
                    ? SuperBoardPaywall(
                        key: ValueKey(
                          'paywall-$liveExperienceGeneration-$resolvedPlacement',
                        ),
                        placement: resolvedPlacement,
                        offeringIdentifier:
                            liveExperienceInput['offering_identifier']
                                ?.toString(),
                        customerId: customerId,
                        locale: locale,
                        attributes: attributes,
                        onPurchased: () => widget.state.record('purchase', {
                          'event': 'purchased',
                          'placement': resolvedPlacement,
                        }),
                        onRestored: () => widget.state.record('purchase', {
                          'event': 'restored',
                          'placement': resolvedPlacement,
                        }),
                        onClosed: () => widget.state.record('purchase', {
                          'event': 'closed',
                          'placement': resolvedPlacement,
                        }),
                        onUnavailable: () => widget.state.record('purchase', {
                          'event': 'unavailable',
                          'placement': resolvedPlacement,
                        }),
                      )
                    // ignore: deprecated_member_use
                    : SuperBoardOnboarding(
                        key: ValueKey(
                          'onboarding-$liveExperienceGeneration-$resolvedPlacement',
                        ),
                        placement: resolvedPlacement,
                        customerId: customerId,
                        locale: locale,
                        attributes: attributes,
                        fallbackTitle: 'No active onboarding',
                        fallbackBody:
                            'Publish an onboarding version for this placement in SuperBoard.',
                        onCompleted: () => widget.state.record('onboarding', {
                          'event': 'completed',
                          'placement': resolvedPlacement,
                        }),
                        onSkipped: () => widget.state.record('onboarding', {
                          'event': 'skipped',
                          'placement': resolvedPlacement,
                        }),
                        onClosed: () => widget.state.record('onboarding', {
                          'event': 'closed',
                          'placement': resolvedPlacement,
                        }),
                        onUnavailable: () => widget.state.record('onboarding', {
                          'event': 'unavailable',
                          'placement': resolvedPlacement,
                        }),
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.title, required this.lines, this.color});
  final String title;
  final List<String> lines;
  final Color? color;
  @override
  Widget build(BuildContext context) => Card(
    color: color,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          ...lines.map((line) => Text(line)),
        ],
      ),
    ),
  );
}

class _Diagnostics extends StatelessWidget {
  const _Diagnostics({required this.state});
  final ReferenceState state;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: SelectableText(
        const JsonEncoder.withIndent('  ').convert({
          'configuration': state.configuration.diagnostics(),
          'authenticated': state.applicationAccessToken.isNotEmpty,
          'current_user_id': state.currentUserId,
          'last_error': state.lastIntegrationError,
        }),
        style: const TextStyle(fontFamily: 'monospace'),
      ),
    ),
  );
}

Map<String, Object?> _defaultInput(ReferenceFeatureId id) => switch (id) {
  ReferenceFeatureId.signIn => {
    'email': 'reference@example.invalid',
    'password': '',
  },
  ReferenceFeatureId.createAccount => {
    'email': 'reference@example.invalid',
    'password': '',
    'name': 'Reference User',
  },
  ReferenceFeatureId.passwordRecovery => {
    'operation': 'request',
    'email': 'reference@example.invalid',
  },
  ReferenceFeatureId.profile => {'operation': 'read'},
  ReferenceFeatureId.notifications => {
    'operation': 'inspect',
    'push_token': '',
  },
  ReferenceFeatureId.files => {
    'operation': 'list',
    'file_id': '',
    'filename': 'reference.txt',
    'content_type': 'text/plain',
    'text': 'SuperBoard reference',
  },
  ReferenceFeatureId.products => {
    'operation': 'inspect',
    'placement': 'default',
  },
  ReferenceFeatureId.paywall => {
    'operation': 'inspect',
    'placement': 'default',
    'package_identifier': '',
  },
  ReferenceFeatureId.dynamicLinks => {
    'title': 'SuperBoard reference',
    'data': {'source': 'superboard-reference'},
  },
  ReferenceFeatureId.support => {
    'operation': 'list',
    'client_conversation_id': 'reference-manual-1',
    'conversation_id': '',
    'client_message_id': 'reference-message-manual-1',
    'body': 'Bonjour depuis SuperBoard Reference',
  },
  ReferenceFeatureId.marketingConsent => {
    'operation': 'load',
    'consented': true,
    'attributes': {'locale': 'fr-CH'},
    'list_ids': <String>[],
    'idempotency_key': 'reference-consent-manual-1',
  },
  ReferenceFeatureId.onboarding => {
    'placement': 'app_launch',
    'locale': 'fr-CH',
    'attributes': <String, Object?>{},
  },
  ReferenceFeatureId.customExtension => {
    'payload': {'message': 'SuperBoard reference'},
    'idempotency_key': 'reference-echo-manual-1',
  },
  _ => const {},
};
