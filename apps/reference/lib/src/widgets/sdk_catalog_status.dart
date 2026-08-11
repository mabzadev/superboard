import 'package:flutter/material.dart';

import '../model/sdk_catalog_status.dart';

class SdkCatalogueStatus extends StatefulWidget {
  const SdkCatalogueStatus({super.key});

  @override
  State<SdkCatalogueStatus> createState() => _SdkCatalogueStatusState();
}

class _SdkCatalogueStatusState extends State<SdkCatalogueStatus> {
  Future<ReferenceSdkCatalogue>? catalogue;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    catalogue ??= DefaultAssetBundle.of(context)
        .loadString('config/sdk-coverage.json')
        .then(ReferenceSdkCatalogue.parse);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<ReferenceSdkCatalogue>(
    future: catalogue,
    builder: (context, snapshot) {
      final value = snapshot.data;
      if (value == null) {
        return const Padding(
          padding: EdgeInsets.only(right: 8),
          child: Chip(label: Text('SDK contract…')),
        );
      }
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ActionChip(
          avatar: Icon(
            value.promotionReady ? Icons.verified_outlined : Icons.schedule,
            size: 16,
          ),
          label: Text(value.summary),
          onPressed: () => _showCatalogue(context, value),
        ),
      );
    },
  );
}

Future<void> _showCatalogue(
  BuildContext context,
  ReferenceSdkCatalogue catalogue,
) => showDialog<void>(
  context: context,
  builder: (context) => AlertDialog(
    title: const Text('SuperBoard SDK catalogue'),
    content: SizedBox(
      width: 620,
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(
            catalogue.promotionReady
                ? 'The complete active SDK set is published.'
                : 'The app remains pinned to published OpenGrow baselines until both SuperBoard v3 candidates are released.',
          ),
          const SizedBox(height: 16),
          for (final library in catalogue.libraries)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(library.id),
              subtitle: Text(
                library.candidatePending
                    ? '${library.packageName} ${library.baselineVersion} → ${library.candidatePackageName} ${library.sourceVersion}'
                    : '${library.packageName} ${library.baselineVersion}',
              ),
              trailing: Chip(label: Text(library.lifecycle)),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Close'),
      ),
    ],
  ),
);
