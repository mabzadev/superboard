class ReferenceConfig {
  const ReferenceConfig({
    required this.environment,
    required this.target,
    required this.apiBaseUrl,
    required this.sdkBaseUrl,
    required this.supportBaseUrl,
    required this.shortLinksBaseUrl,
    required this.filesBaseUrl,
    required this.mailPreviewBaseUrl,
    required this.projectKey,
    required this.projectId,
    required this.sdkPlatform,
    required this.sdkIdentifier,
    required this.projectEnvironment,
    required this.liveMode,
    this.platformRevision = 'local',
    this.referenceRevision = 'local',
  });

  factory ReferenceConfig.fromEnvironment() => ReferenceConfig(
    environment: const String.fromEnvironment(
      'SUPERBOARD_ENVIRONMENT',
      defaultValue: String.fromEnvironment('OPENGROW_ENVIRONMENT'),
    ),
    target: const String.fromEnvironment(
      'SUPERBOARD_TARGET',
      defaultValue: String.fromEnvironment('OPENGROW_TARGET'),
    ),
    apiBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_API_URL',
      defaultValue: String.fromEnvironment('OPENGROW_API_URL'),
    ),
    sdkBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_SDK_URL',
      defaultValue: String.fromEnvironment('OPENGROW_SDK_URL'),
    ),
    supportBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_SUPPORT_URL',
      defaultValue: String.fromEnvironment('OPENGROW_SUPPORT_URL'),
    ),
    shortLinksBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_SHORT_LINKS_URL',
      defaultValue: String.fromEnvironment('OPENGROW_SHORT_LINKS_URL'),
    ),
    filesBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_FILES_URL',
      defaultValue: String.fromEnvironment('OPENGROW_FILES_URL'),
    ),
    mailPreviewBaseUrl: const String.fromEnvironment(
      'SUPERBOARD_MAIL_PREVIEW_URL',
      defaultValue: String.fromEnvironment('OPENGROW_MAIL_PREVIEW_URL'),
    ),
    projectKey: const String.fromEnvironment(
      'SUPERBOARD_PROJECT_KEY',
      defaultValue: String.fromEnvironment('OPENGROW_PROJECT_KEY'),
    ),
    projectId: int.tryParse(
      const String.fromEnvironment(
        'SUPERBOARD_PROJECT_ID',
        defaultValue: String.fromEnvironment('OPENGROW_PROJECT_ID'),
      ),
    ) ?? 0,
    sdkPlatform: const String.fromEnvironment(
      'SUPERBOARD_SDK_PLATFORM',
      defaultValue: String.fromEnvironment('OPENGROW_SDK_PLATFORM'),
    ),
    sdkIdentifier: const String.fromEnvironment(
      'SUPERBOARD_SDK_IDENTIFIER',
      defaultValue: String.fromEnvironment('OPENGROW_SDK_IDENTIFIER'),
    ),
    projectEnvironment: const String.fromEnvironment(
      'SUPERBOARD_PROJECT_ENVIRONMENT',
      defaultValue: String.fromEnvironment('OPENGROW_PROJECT_ENVIRONMENT'),
    ),
    liveMode: const bool.fromEnvironment(
      'SUPERBOARD_LIVE_MODE',
      defaultValue: bool.fromEnvironment('OPENGROW_LIVE_MODE'),
    ),
    platformRevision: const String.fromEnvironment(
      'SUPERBOARD_PLATFORM_REVISION',
      defaultValue: String.fromEnvironment(
        'OPENGROW_PLATFORM_REVISION',
        defaultValue: 'local',
      ),
    ),
    referenceRevision: const String.fromEnvironment(
      'SUPERBOARD_REFERENCE_REVISION',
      defaultValue: String.fromEnvironment(
        'OPENGROW_REFERENCE_REVISION',
        defaultValue: 'local',
      ),
    ),
  );

  final String environment;
  final String target;
  final String apiBaseUrl;
  final String sdkBaseUrl;
  final String supportBaseUrl;
  final String shortLinksBaseUrl;
  final String filesBaseUrl;
  final String mailPreviewBaseUrl;
  final String projectKey;
  final int projectId;
  final String sdkPlatform;
  final String sdkIdentifier;
  final String projectEnvironment;
  final bool liveMode;
  final String platformRevision;
  final String referenceRevision;

  List<String> validate() {
    final errors = <String>[];
    if (!{'development', 'production'}.contains(environment)) {
      errors.add('SUPERBOARD_ENVIRONMENT must be development or production.');
    }
    if (target.trim().isEmpty) errors.add('SUPERBOARD_TARGET is required.');
    for (final entry in endpoints.entries) {
      final expected = _endpointContract[entry.key];
      if (entry.value != expected) {
        errors.add('${entry.key} must be $expected.');
      }
    }
    if (liveMode && projectKey.trim().isEmpty) {
      errors.add('SUPERBOARD_PROJECT_KEY is required in live mode.');
    }
    if (liveMode && projectId <= 0) {
      errors.add('SUPERBOARD_PROJECT_ID must be positive in live mode.');
    }
    if (liveMode && !{'ios', 'android', 'web'}.contains(sdkPlatform)) {
      errors.add('SUPERBOARD_SDK_PLATFORM must be ios, android or web.');
    }
    if (liveMode && sdkIdentifier.trim().isEmpty) {
      errors.add('SUPERBOARD_SDK_IDENTIFIER is required in live mode.');
    }
    if (liveMode && !{'production', 'test'}.contains(projectEnvironment)) {
      errors.add('SUPERBOARD_PROJECT_ENVIRONMENT must be production or test.');
    }
    if (liveMode && !_gitRevision.hasMatch(platformRevision)) {
      errors.add('SUPERBOARD_PLATFORM_REVISION must be an exact Git SHA.');
    }
    if (liveMode && !_gitRevision.hasMatch(referenceRevision)) {
      errors.add('SUPERBOARD_REFERENCE_REVISION must be an exact Git SHA.');
    }
    return errors;
  }

  Map<String, String> get endpoints => {
    'API': apiBaseUrl,
    'SDK': sdkBaseUrl,
    'Support': supportBaseUrl,
    'Short links': shortLinksBaseUrl,
    'Files': filesBaseUrl,
    'Mail preview': mailPreviewBaseUrl,
  };

  Map<String, Object> diagnostics() => {
    'environment': environment,
    'target': target,
    'live_mode': liveMode,
    'project_configured': projectKey.isNotEmpty,
    'project_id_configured': projectId > 0,
    'sdk_platform': sdkPlatform,
    'sdk_identifier': sdkIdentifier,
    'project_environment': projectEnvironment,
    'platform_revision': platformRevision,
    'reference_revision': referenceRevision,
    'endpoints': endpoints,
  };

  String get revisionSummary =>
      'platform ${_shortRevision(platformRevision)} · reference ${_shortRevision(referenceRevision)}';
}

final _gitRevision = RegExp(r'^[0-9a-f]{40}$');

const _endpointContract = <String, String>{
  'API': 'https://api.mbza.dev',
  'SDK': 'https://sdk.mbza.dev',
  'Support': 'https://api.mbza.dev/api/v1/support-client',
  'Short links': 'https://in.mbza.dev',
  'Files': 'https://files.mbza.dev',
  'Mail preview': 'https://mail.mbza.dev',
};

String _shortRevision(String value) =>
    _gitRevision.hasMatch(value) ? value.substring(0, 12) : value;
