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
        'Validate target configuration and initialize the OpenGrow SDK.',
    actions: [
      'OpenGrowBootstrap',
      'opengrowInitializeAuto',
      'opengrowInitializeAuthenticated',
      'opengrowApplicationRuntimePolicyJson',
    ],
    stateKeys: ['environment', 'projectKey', 'lastIntegrationError'],
    owner: 'OpenGrow SDK',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.signIn,
    title: 'Sign in',
    description:
        'Authenticate with email/password, Google, or Apple through the configured identity gateway.',
    actions: [
      'opengrowApplicationSignInPasswordJson',
      'opengrowApplicationSignInProviderJson',
    ],
    stateKeys: ['applicationAccessToken', 'currentUserId'],
    owner: 'OpenGrow Identity',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.createAccount,
    title: 'Create account',
    description:
        'Create an allowlisted account and exercise verification policy.',
    actions: ['opengrowApplicationRegisterJson'],
    stateKeys: ['currentUserId'],
    owner: 'OpenGrow Identity',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.passwordRecovery,
    title: 'Password recovery',
    description:
        'Request a transactional recovery email and inspect capture delivery in development.',
    actions: [
      'opengrowApplicationRequestPasswordResetJson',
      'opengrowApplicationResetPasswordJson',
    ],
    stateKeys: ['lastIntegrationError'],
    owner: 'OpenGrow Identity + Email',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.home,
    title: 'Home',
    description:
        'Show the authenticated identity and enabled application capabilities.',
    actions: ['loadProfile', 'loadFeatureManifest'],
    stateKeys: ['currentUserId'],
    owner: 'OpenGrow App',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.profile,
    title: 'Profile',
    description:
        'Update attributes, sign out, and request complete account deletion.',
    actions: [
      'opengrowIdentify',
      'opengrowSetUserAttributesJson',
      'opengrowApplicationProfileJson',
      'opengrowApplicationUpdateProfileJson',
      'opengrowApplicationDeleteAccountJson',
      'opengrowApplicationLogoutJson',
    ],
    stateKeys: ['currentUserId', 'applicationAccessToken'],
    owner: 'OpenGrow Identity + App',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.notifications,
    title: 'Notifications',
    description: 'Register a push token and inspect the application inbox.',
    actions: [
      'opengrowSetPushToken',
      'opengrowGetUnreadMessageCount',
      'opengrowDisplayMessages',
    ],
    stateKeys: ['lastNotificationJson'],
    owner: 'OpenGrow Notifications',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.files,
    title: 'Files',
    description:
        'Upload, list, download, and delete an application-owned file.',
    actions: [
      'opengrowApplicationUploadFileJson',
      'opengrowApplicationListFilesJson',
      'opengrowApplicationDownloadFile',
      'opengrowApplicationDeleteFileJson',
    ],
    stateKeys: ['lastFileJson'],
    owner: 'OpenGrow Files',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.products,
    title: 'Products',
    description: 'Resolve offerings and verified customer entitlements.',
    actions: [
      'opengrowGetOfferings',
      'opengrowGetCustomerInfoJson',
      'opengrowGetLastVerifiedCustomerInfoJson',
      'opengrowRestore',
    ],
    stateKeys: ['lastCustomerInfoJson'],
    owner: 'OpenGrow Products + Billing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.paywall,
    title: 'Paywall',
    description: 'Resolve a remote placement and track the purchase lifecycle.',
    actions: [
      'OpenGrowPaywall',
      'opengrowGetPurchaseConfigurationJson',
      'opengrowPurchase',
      'opengrowGetLastPurchaseResultJson',
    ],
    stateKeys: ['lastPurchaseResultJson'],
    owner: 'OpenGrow Paywalls + Billing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.dynamicLinks,
    title: 'Dynamic links',
    description: 'Generate a short link and inspect deep-link attribution.',
    actions: ['opengrowGenerateLinkJson', 'opengrowGetLastDeepLinkJson'],
    stateKeys: ['lastDeepLinkJson'],
    owner: 'OpenGrow Dynamic Links',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.support,
    title: 'Support inbox',
    description:
        'Open a conversation, exchange attachments, use realtime state, and submit CSAT.',
    actions: [
      'opengrowSupportOpenConversation',
      'opengrowSupportGetConfigurationJson',
      'opengrowSupportListConversationsJson',
      'opengrowSupportUpdateConversationJson',
      'opengrowSupportMessagesJson',
      'opengrowSupportSendAdvanced',
      'opengrowSupportUploadAttachmentJson',
      'opengrowSupportDownloadAttachment',
      'opengrowSupportSendAttachment',
      'opengrowSupportMarkRead',
      'opengrowSupportSetTyping',
      'opengrowSupportConnectRealtime',
      'opengrowSupportDisconnectRealtime',
      'opengrowSupportGetLastRealtimeEventJson',
      'opengrowSupportSubmitCsatJson',
    ],
    stateKeys: ['lastSupportEventJson'],
    owner: 'OpenGrow Support',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.marketingConsent,
    title: 'Marketing consent',
    description:
        'Manage newsletter consent, preferences, and unsubscribe state.',
    actions: [
      'opengrowApplicationUpdateMarketingConsentJson',
      'opengrowApplicationMarketingPreferencesJson',
    ],
    stateKeys: ['lastMarketingConsentJson'],
    owner: 'OpenGrow Marketing',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.onboarding,
    title: 'Onboarding',
    description:
        'Resolve, progress, complete, and roll back a versioned onboarding flow.',
    actions: ['OpenGrowOnboarding'],
    stateKeys: ['lastOnboardingJson'],
    owner: 'OpenGrow Onboardings',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.customExtension,
    title: 'Custom extension',
    description:
        'Create, list, read, and prove terminal cancellation semantics for project/owner-scoped reference.echo jobs or a revision-bound MBZA acceptance receipt through the versioned custom Worker facade.',
    actions: [
      'opengrowApplicationCreateCustomJobJson',
      'opengrowApplicationListCustomJobsJson',
      'opengrowApplicationGetCustomJobJson',
      'opengrowApplicationCancelCustomJobJson',
    ],
    stateKeys: ['lastCustomJobJson'],
    owner: 'OpenGrow API + application Custom Worker',
  ),
  ReferenceFeature(
    id: ReferenceFeatureId.diagnostics,
    title: 'Diagnostics',
    description:
        'Show sanitized configuration, SDK state, service health, and the last recoverable error.',
    actions: ['loadHealth', 'copyDiagnostics'],
    stateKeys: ['lastIntegrationError'],
    owner: 'OpenGrow Platform',
  ),
];
