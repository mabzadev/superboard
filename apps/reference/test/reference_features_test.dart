import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_reference/src/model/reference_feature.dart';

void main() {
  test(
    'reference contains each of the sixteen baseline journeys exactly once',
    () {
      expect(referenceFeatures, hasLength(16));
      expect(
        referenceFeatures.map((feature) => feature.id).toSet(),
        ReferenceFeatureId.values.toSet(),
      );
      for (final feature in referenceFeatures) {
        expect(feature.actions, isNotEmpty, reason: feature.title);
        expect(feature.stateKeys, isNotEmpty, reason: feature.title);
        expect(feature.owner, isNotEmpty, reason: feature.title);
      }
    },
  );

  test('custom extension uses only the authenticated public SDK facade', () {
    final custom = referenceFeatures.singleWhere(
      (feature) => feature.id == ReferenceFeatureId.customExtension,
    );
    expect(custom.actions, [
      'opengrowApplicationCreateCustomJobJson',
      'opengrowApplicationListCustomJobsJson',
      'opengrowApplicationGetCustomJobJson',
      'opengrowApplicationCancelCustomJobJson',
    ]);
    expect(custom.actions.join(' '), isNot(contains('CUSTOM_WORKER_TOKEN')));
  });

  test(
    'support uses canonical SuperBoard Support and never declares Chatwoot actions',
    () {
      final support = referenceFeatures.singleWhere(
        (feature) => feature.id == ReferenceFeatureId.support,
      );
      expect(
        support.actions.join(' ').toLowerCase(),
        isNot(contains('chatwoot')),
      );
      expect(support.actions, contains('opengrowSupportConnectRealtime'));
    },
  );
}
