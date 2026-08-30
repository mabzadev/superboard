enum ReferenceFeatureId {
  bootstrap,
  signIn,
  createAccount,
  passwordRecovery,
  home,
  profile,
  notifications,
  files,
  products,
  paywall,
  dynamicLinks,
  support,
  marketingConsent,
  onboarding,
  customExtension,
  diagnostics,
}

class ReferenceFeature {
  const ReferenceFeature({
    required this.id,
    required this.title,
    required this.description,
    required this.actions,
    required this.stateKeys,
    required this.owner,
  });

  final ReferenceFeatureId id;
  final String title;
  final String description;
  final List<String> actions;
  final List<String> stateKeys;
  final String owner;
}

const referenceFeatures = <ReferenceFeature>[
  ReferenceFeature(
    id: ReferenceFeatureId.bootstrap,
    title: 'Bootstrap',
    description:
        'Validate target configuration and initialize the SuperBoard SDK.',
    actions: [
      'SuperBoardBootstrap',
      'superboardInitializeAuto',
      'superboardInitializeAuthenticated',
      'superboardApplicationRuntimePolicyJson',
    ],
    stateKeys: ['environment', 'projectKey', 'lastIntegrationError'],
    owner: 'SuperBoard SDK',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.signIn,
    title: 'Sign in',
    description:
        'Authenticate with email/password, Google, or Apple through the configured identity gateway.',
    actions: [
      'superboardApplicationSignInPasswordJson',
      'superboardApplicationSignInProviderJson',
    ],
    stateKeys: ['applicationAccessToken', 'currentUserId'],
    owner: 'SuperBoard Identity',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.createAccount,
    title: 'Create account',
    description:
        'Create an allowlisted account and exercise verification policy.',
    actions: ['superboardApplicationRegisterJson'],
    stateKeys: ['currentUserId'],
    owner: 'SuperBoard Identity',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.passwordRecovery,
    title: 'Password recovery',
    description:
        'Request a transactional recovery email and inspect capture delivery in development.',
    actions: [
      'superboardApplicationRequestPasswordResetJson',
      'superboardApplicationResetPasswordJson',
    ],
    stateKeys: ['lastIntegrationError'],
    owner: 'SuperBoard Identity + Email',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.home,
    title: 'Home',
    description:
        'Show the authenticated identity and enabled application capabilities.',
    actions: ['loadProfile', 'loadFeatureManifest'],
    stateKeys: ['currentUserId'],
    owner: 'SuperBoard App',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.profile,
    title: 'Profile',
    description:
        'Update attributes, sign out, and request complete account deletion.',
    actions: [
      'superboardIdentify',
      'superboardSetUserAttributesJson',
      'superboardApplicationProfileJson',
      'superboardApplicationUpdateProfileJson',
      'superboardApplicationDeleteAccountJson',
      'superboardApplicationLogoutJson',
    ],
    stateKeys: ['currentUserId', 'applicationAccessToken'],
    owner: 'SuperBoard Identity + App',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.notifications,
    title: 'Notifications',
    description: 'Register a push token and inspect the application inbox.',
    actions: [
      'superboardSetPushToken',
      'superboardGetUnreadMessageCount',
      'superboardDisplayMessages',
    ],
    stateKeys: ['lastNotificationJson'],
    owner: 'SuperBoard Notifications',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.files,
    title: 'Files',
    description:
        'Upload, list, download, and delete an application-owned file.',
    actions: [
      'superboardApplicationUploadFileJson',
      'superboardApplicationListFilesJson',
      'superboardApplicationDownloadFile',
      'superboardApplicationDeleteFileJson',
    ],
    stateKeys: ['lastFileJson'],
    owner: 'SuperBoard Files',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.products,
    title: 'Products',
    description: 'Resolve offerings and verified customer entitlements.',
    actions: [
      'superboardGetOfferings',
      'superboardGetCustomerInfoJson',
      'superboardGetLastVerifiedCustomerInfoJson',
      'superboardRestore',
    ],
    stateKeys: ['lastCustomerInfoJson'],
    owner: 'SuperBoard Products + Billing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.paywall,
    title: 'Paywall',
    description: 'Resolve a remote placement and track the purchase lifecycle.',
    actions: [
      'SuperBoardPaywall',
      'superboardGetPurchaseConfigurationJson',
      'superboardPurchase',
      'superboardGetLastPurchaseResultJson',
    ],
    stateKeys: ['lastPurchaseResultJson'],
    owner: 'SuperBoard Paywalls + Billing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.dynamicLinks,
    title: 'Dynamic links',
    description: 'Generate a short link and inspect deep-link attribution.',
    actions: ['superboardGenerateLinkJson', 'superboardGetLastDeepLinkJson'],
    stateKeys: ['lastDeepLinkJson'],
    owner: 'SuperBoard Dynamic Links',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.support,
    title: 'Support inbox',
    description:
        'Open a conversation, exchange attachments, use realtime state, and submit CSAT.',
    actions: [
      'superboardSupportOpenConversation',
      'superboardSupportGetConfigurationJson',
      'superboardSupportListConversationsJson',
      'superboardSupportUpdateConversationJson',
      'superboardSupportMessagesJson',
      'superboardSupportSendAdvanced',
      'superboardSupportUploadAttachmentJson',
      'superboardSupportDownloadAttachment',
      'superboardSupportSendAttachment',
      'superboardSupportMarkRead',
      'superboardSupportSetTyping',
      'superboardSupportConnectRealtime',
      'superboardSupportDisconnectRealtime',
      'superboardSupportGetLastRealtimeEventJson',
      'superboardSupportSubmitCsatJson',
    ],
    stateKeys: ['lastSupportEventJson'],
    owner: 'SuperBoard Support',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.marketingConsent,
    title: 'Marketing consent',
    description:
        'Manage newsletter consent, preferences, and unsubscribe state.',
    actions: [
      'superboardApplicationUpdateMarketingConsentJson',
      'superboardApplicationMarketingPreferencesJson',
    ],
    stateKeys: ['lastMarketingConsentJson'],
    owner: 'SuperBoard Marketing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.onboarding,
    title: 'Onboarding',
    description:
        'Resolve, progress, complete, and roll back a versioned onboarding flow.',
    actions: ['SuperBoardOnboarding'],
    stateKeys: ['lastOnboardingJson'],
    owner: 'SuperBoard Onboardings',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.customExtension,
    title: 'Custom extension',
    description:
        'Create, list, read, and prove terminal cancellation semantics for project/owner-scoped reference.echo jobs or a revision-bound MBZA acceptance receipt through the versioned custom Worker facade.',
    actions: [
      'superboardApplicationCreateCustomJobJson',
      'superboardApplicationListCustomJobsJson',
      'superboardApplicationGetCustomJobJson',
      'superboardApplicationCancelCustomJobJson',
    ],
    stateKeys: ['lastCustomJobJson'],
    owner: 'SuperBoard API + application Custom Worker',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.diagnostics,
    title: 'Diagnostics',
    description:
        'Show sanitized configuration, SDK state, service health, and the last recoverable error.',
    actions: ['loadHealth', 'copyDiagnostics'],
    stateKeys: ['lastIntegrationError'],
    owner: 'SuperBoard Platform',
  ),
];
