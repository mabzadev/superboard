import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_reference/src/config/reference_config.dart';

void main() {
  const valid = ReferenceConfig(
    environment: 'development',
    target: 'mabza-development',
    apiBaseUrl: 'https://api.mabza.dev',
    sdkBaseUrl: 'https://sdk.mabza.dev',
    supportBaseUrl: 'https://api.mabza.dev/api/v1/support-client',
    shortLinksBaseUrl: 'https://in.mabza.dev',
    filesBaseUrl: 'https://files.mabza.dev',
    mailPreviewBaseUrl: 'https://mail.mabza.dev',
    projectKey: '',
    projectId: 0,
    sdkPlatform: 'web',
    sdkIdentifier: 'reference.mabza.dev',
    projectEnvironment: 'test',
    liveMode: false,
  );

  test('demo configuration validates without project credentials', () {
    expect(valid.validate(), isEmpty);
    expect(valid.diagnostics(), isNot(contains('projectKey')));
  });

  test('live configuration fails closed without a project identity', () {
    final live = ReferenceConfig(
      environment: valid.environment,
      target: valid.target,
      apiBaseUrl: valid.apiBaseUrl,
      sdkBaseUrl: valid.sdkBaseUrl,
      supportBaseUrl: valid.supportBaseUrl,
      shortLinksBaseUrl: valid.shortLinksBaseUrl,
      filesBaseUrl: valid.filesBaseUrl,
      mailPreviewBaseUrl: valid.mailPreviewBaseUrl,
      projectKey: '',
      projectId: 0,
      sdkPlatform: '',
      sdkIdentifier: '',
      projectEnvironment: '',
      liveMode: true,
    );
    expect(live.validate(), hasLength(7));
  });

  test('runtime configuration rejects every non-canonical endpoint form', () {
    const invalid = <String, String>{
      'API': 'http://api.mabza.dev',
      'SDK': 'https://sdk.mabza.dev?debug=true',
      'Support': 'https://api.mabza.dev/api/v1/support-admin',
      'Short links': 'https://in.mabza.dev/path',
      'Files': 'https://user:secret@files.mabza.dev',
      'Mail preview': 'https://mail.mabza.dev#inbox',
    };
    for (final entry in invalid.entries) {
      final candidate = _replaceEndpoint(valid, entry.key, entry.value);
      expect(
        candidate.validate(),
        contains(startsWith('${entry.key} must be https://')),
        reason: '${entry.key} accepted ${entry.value}',
      );
    }
  });

  test('live configuration accepts exact build provenance', () {
    const revision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    final live = ReferenceConfig(
      environment: valid.environment,
      target: valid.target,
      apiBaseUrl: valid.apiBaseUrl,
      sdkBaseUrl: valid.sdkBaseUrl,
      supportBaseUrl: valid.supportBaseUrl,
      shortLinksBaseUrl: valid.shortLinksBaseUrl,
      filesBaseUrl: valid.filesBaseUrl,
      mailPreviewBaseUrl: valid.mailPreviewBaseUrl,
      projectKey: 'reference-public-sdk-key',
      projectId: 42,
      sdkPlatform: 'web',
      sdkIdentifier: 'reference.mabza.dev',
      projectEnvironment: 'test',
      liveMode: true,
      platformRevision: revision,
      referenceRevision: revision,
    );
    expect(live.validate(), isEmpty);
    expect(
      live.revisionSummary,
      'platform aaaaaaaaaaaa · reference aaaaaaaaaaaa',
    );
    expect(live.diagnostics()['platform_revision'], revision);
  });
}

ReferenceConfig _replaceEndpoint(
  ReferenceConfig base,
  String endpoint,
  String value,
) => ReferenceConfig(
  environment: base.environment,
  target: base.target,
  apiBaseUrl: endpoint == 'API' ? value : base.apiBaseUrl,
  sdkBaseUrl: endpoint == 'SDK' ? value : base.sdkBaseUrl,
  supportBaseUrl: endpoint == 'Support' ? value : base.supportBaseUrl,
  shortLinksBaseUrl: endpoint == 'Short links' ? value : base.shortLinksBaseUrl,
  filesBaseUrl: endpoint == 'Files' ? value : base.filesBaseUrl,
  mailPreviewBaseUrl: endpoint == 'Mail preview'
      ? value
      : base.mailPreviewBaseUrl,
  projectKey: base.projectKey,
  projectId: base.projectId,
  sdkPlatform: base.sdkPlatform,
  sdkIdentifier: base.sdkIdentifier,
  projectEnvironment: base.projectEnvironment,
  liveMode: base.liveMode,
  platformRevision: base.platformRevision,
  referenceRevision: base.referenceRevision,
);
