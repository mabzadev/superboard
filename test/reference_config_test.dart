import 'package:flutter_test/flutter_test.dart';
import 'package:grow_reference/src/config/reference_config.dart';

void main() {
  const valid = ReferenceConfig(
    environment: 'development',
    target: 'reference-development',
    apiBaseUrl: 'https://api.example.test',
    sdkBaseUrl: 'https://sdk.example.test',
    supportBaseUrl: 'https://api.example.test/api/v1/support-client',
    shortLinksBaseUrl: 'https://in.example.test',
    filesBaseUrl: 'https://files.example.test',
    mailPreviewBaseUrl: 'https://mail.example.test',
    projectKey: '',
    projectId: 0,
    sdkPlatform: 'web',
    sdkIdentifier: 'reference.example.test',
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
      sdkIdentifier: 'reference.example.test',
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
