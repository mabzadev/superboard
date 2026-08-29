// ignore_for_file: deprecated_member_use

// Compatibility surface for an atomic FlutterFlow application cutover.
//
// New projects must use the SuperBoard names exported from
// `superboard_flutterflow.dart`. These aliases let a project update its package
// coordinate and generated imports before renaming every custom-code call in
// the same FlutterFlow commit. They are intentionally not registered as new
// FlutterFlow Library actions.

import 'dart:typed_data';

import 'actions.dart';
import 'application_actions.dart';
import 'application_client.dart';
import 'application_session.dart';
import 'bootstrap.dart';
import 'customer_events.dart';
import 'experience_client.dart';
import 'models.dart';
import 'onboarding.dart';
import 'paywall.dart';
import 'support/actions.dart';
import 'support/client.dart';
import 'support/models.dart';
import 'support/realtime.dart';
import 'support/support_actions.dart';

@Deprecated('Use SuperBoardFlutterFlowState.')
typedef OpenGrowFlutterFlowState = SuperBoardFlutterFlowState;
@Deprecated('Use SuperBoardFlutterFlowPackage.')
typedef OpenGrowFlutterFlowPackage = SuperBoardFlutterFlowPackage;
@Deprecated('Use SuperBoardFlutterFlowOffering.')
typedef OpenGrowFlutterFlowOffering = SuperBoardFlutterFlowOffering;
@Deprecated('Use SuperBoardFlutterFlowEntitlement.')
typedef OpenGrowFlutterFlowEntitlement = SuperBoardFlutterFlowEntitlement;
@Deprecated('Use SuperBoardApplicationException.')
typedef OpenGrowApplicationException = SuperBoardApplicationException;
@Deprecated('Use SuperBoardApplicationClient.')
typedef OpenGrowApplicationClient = SuperBoardApplicationClient;
@Deprecated('Use SuperBoardApplicationSessionStorage.')
typedef OpenGrowApplicationSessionStorage = SuperBoardApplicationSessionStorage;
@Deprecated('Use FlutterSuperBoardApplicationSessionStorage.')
typedef FlutterOpenGrowApplicationSessionStorage =
    FlutterSuperBoardApplicationSessionStorage;
@Deprecated('Use SuperBoardApplicationSession.')
typedef OpenGrowApplicationSession = SuperBoardApplicationSession;
@Deprecated('Use SuperBoardApplicationSessionManager.')
typedef OpenGrowApplicationSessionManager = SuperBoardApplicationSessionManager;
@Deprecated('Use SuperBoardCustomerEvent.')
typedef OpenGrowCustomerEvent = SuperBoardCustomerEvent;
@Deprecated('Use SuperBoardCustomerEventsException.')
typedef OpenGrowCustomerEventsException = SuperBoardCustomerEventsException;
@Deprecated('Use SuperBoardCustomerEventsClient.')
typedef OpenGrowCustomerEventsClient = SuperBoardCustomerEventsClient;
@Deprecated('Use SuperBoardCustomerEventsSdk.')
typedef OpenGrowCustomerEventsSdk = SuperBoardCustomerEventsSdk;
@Deprecated('Use SuperBoardExperienceKind.')
typedef OpenGrowExperienceKind = SuperBoardExperienceKind;
@Deprecated('Use SuperBoardResolvedExperience.')
typedef OpenGrowResolvedExperience = SuperBoardResolvedExperience;
@Deprecated('Use SuperBoardExperienceEvent.')
typedef OpenGrowExperienceEvent = SuperBoardExperienceEvent;
@Deprecated('Use SuperBoardExperienceCache.')
typedef OpenGrowExperienceCache = SuperBoardExperienceCache;
@Deprecated('Use SuperBoardCacheEntry.')
typedef OpenGrowCacheEntry = SuperBoardCacheEntry;
@Deprecated('Use SuperBoardMemoryExperienceCache.')
typedef OpenGrowMemoryExperienceCache = SuperBoardMemoryExperienceCache;
@Deprecated('Use SuperBoardExperienceException.')
typedef OpenGrowExperienceException = SuperBoardExperienceException;
@Deprecated('Use SuperBoardExperienceClient.')
typedef OpenGrowExperienceClient = SuperBoardExperienceClient;
@Deprecated('Use SuperBoardExperienceSdk.')
typedef OpenGrowExperienceSdk = SuperBoardExperienceSdk;
@Deprecated('Use SuperBoardMarketingConsentUpdater.')
typedef OpenGrowMarketingConsentUpdater = SuperBoardMarketingConsentUpdater;
@Deprecated('Use SuperBoardBootstrap.')
typedef OpenGrowBootstrap = SuperBoardBootstrap;
@Deprecated('Use SuperBoardPaywall.')
typedef OpenGrowPaywall = SuperBoardPaywall;
@Deprecated('Use SuperBoardOnboarding.')
typedef OpenGrowOnboarding = SuperBoardOnboarding;
@Deprecated('Use SuperBoardRestorePurchasesButton.')
typedef OpenGrowRestorePurchasesButton = SuperBoardRestorePurchasesButton;
@Deprecated('Use SuperBoardCustomerCenter.')
typedef OpenGrowCustomerCenter = SuperBoardCustomerCenter;
@Deprecated('Use SuperBoardIdentityTokenProvider.')
typedef OpenGrowIdentityTokenProvider = SuperBoardIdentityTokenProvider;
@Deprecated('Use SuperBoardMessagingException.')
typedef OpenGrowMessagingException = SuperBoardMessagingException;
@Deprecated('Use SuperBoardMessagingClient.')
typedef OpenGrowMessagingClient = SuperBoardMessagingClient;
@Deprecated('Use SuperBoardConversation.')
typedef OpenGrowConversation = SuperBoardConversation;
@Deprecated('Use SuperBoardMessage.')
typedef OpenGrowMessage = SuperBoardMessage;
@Deprecated('Use SuperBoardMessageAttachment.')
typedef OpenGrowMessageAttachment = SuperBoardMessageAttachment;
@Deprecated('Use SuperBoardMessagingConnectionFactory.')
typedef OpenGrowMessagingConnectionFactory =
    SuperBoardMessagingConnectionFactory;
@Deprecated('Use SuperBoardMessagingConnection.')
typedef OpenGrowMessagingConnection = SuperBoardMessagingConnection;
@Deprecated('Use SuperBoardMessagingRealtime.')
typedef OpenGrowMessagingRealtime = SuperBoardMessagingRealtime;

@Deprecated('Use superboardVerifiedCustomerInfoJsonStream.')
Stream<String> get opengrowVerifiedCustomerInfoJsonStream =>
    superboardVerifiedCustomerInfoJsonStream;
@Deprecated('Use superboardPurchaseResultJsonStream.')
Stream<String> get opengrowPurchaseResultJsonStream =>
    superboardPurchaseResultJsonStream;
@Deprecated('Use superboardSupportEventJsonStream.')
Stream<String> get opengrowSupportEventJsonStream =>
    superboardSupportEventJsonStream;
@Deprecated('Use superboardMessagingEventJsonStream.')
Stream<String> get opengrowMessagingEventJsonStream =>
    superboardMessagingEventJsonStream;

// The 35 functions referenced by the reviewed application migration plan.
@Deprecated('Use superboardApplicationInitialize.')
final opengrowApplicationInitialize = superboardApplicationInitialize;
@Deprecated('Use superboardApplicationRestoreSessionJson.')
final opengrowApplicationRestoreSessionJson =
    superboardApplicationRestoreSessionJson;
@Deprecated('Use superboardApplicationCurrentSessionJson.')
final opengrowApplicationCurrentSessionJson =
    superboardApplicationCurrentSessionJson;
@Deprecated('Use superboardApplicationAccessToken.')
final opengrowApplicationAccessToken = superboardApplicationAccessToken;
@Deprecated('Use superboardApplicationSignInProviderJson.')
final opengrowApplicationSignInProviderJson =
    superboardApplicationSignInProviderJson;
@Deprecated('Use superboardApplicationSignInPasswordJson.')
final opengrowApplicationSignInPasswordJson =
    superboardApplicationSignInPasswordJson;
@Deprecated('Use superboardApplicationSignInAnonymousJson.')
final opengrowApplicationSignInAnonymousJson =
    superboardApplicationSignInAnonymousJson;
@Deprecated('Use superboardApplicationRefreshJson.')
final opengrowApplicationRefreshJson = superboardApplicationRefreshJson;
@Deprecated('Use superboardApplicationLogoutJson.')
final opengrowApplicationLogoutJson = superboardApplicationLogoutJson;
@Deprecated('Use superboardApplicationDeleteAccountJson.')
final opengrowApplicationDeleteAccountJson =
    superboardApplicationDeleteAccountJson;
@Deprecated('Use superboardPurchaseLogout.')
final opengrowPurchaseLogout = superboardPurchaseLogout;
@Deprecated('Use superboardApplicationRuntimePolicyJson.')
final opengrowApplicationRuntimePolicyJson =
    superboardApplicationRuntimePolicyJson;
@Deprecated('Use superboardApplicationListFilesJson.')
final opengrowApplicationListFilesJson = superboardApplicationListFilesJson;
@Deprecated('Use superboardApplicationUploadFileJson.')
final opengrowApplicationUploadFileJson = superboardApplicationUploadFileJson;
@Deprecated('Use superboardApplicationDownloadFile.')
Future<Uint8List> opengrowApplicationDownloadFile(String fileId) =>
    superboardApplicationDownloadFile(fileId);
@Deprecated('Use superboardApplicationDeleteFileJson.')
final opengrowApplicationDeleteFileJson = superboardApplicationDeleteFileJson;
@Deprecated('Use superboardSetPushToken.')
final opengrowSetPushToken = superboardSetPushToken;
@Deprecated('Use superboardPurchaseLogin.')
final opengrowPurchaseLogin = superboardPurchaseLogin;
@Deprecated('Use superboardPurchase.')
final opengrowPurchase = superboardPurchase;
@Deprecated('Use superboardRestore.')
final opengrowRestore = superboardRestore;
@Deprecated('Use superboardGetCustomerInfoJson.')
final opengrowGetCustomerInfoJson = superboardGetCustomerInfoJson;
@Deprecated('Use superboardGetVirtualCurrenciesJson.')
final opengrowGetVirtualCurrenciesJson = superboardGetVirtualCurrenciesJson;
@Deprecated('Use superboardApplicationMarketingPreferencesJson.')
final opengrowApplicationMarketingPreferencesJson =
    superboardApplicationMarketingPreferencesJson;
@Deprecated('Use superboardApplicationUpdateMarketingConsentJson.')
final opengrowApplicationUpdateMarketingConsentJson =
    superboardApplicationUpdateMarketingConsentJson;
@Deprecated('Use superboardApplicationCreateCustomJobJson.')
final opengrowApplicationCreateCustomJobJson =
    superboardApplicationCreateCustomJobJson;
@Deprecated('Use superboardApplicationListCustomJobsJson.')
final opengrowApplicationListCustomJobsJson =
    superboardApplicationListCustomJobsJson;
@Deprecated('Use superboardApplicationGetCustomJobJson.')
final opengrowApplicationGetCustomJobJson =
    superboardApplicationGetCustomJobJson;
@Deprecated('Use superboardApplicationCancelCustomJobJson.')
final opengrowApplicationCancelCustomJobJson =
    superboardApplicationCancelCustomJobJson;
@Deprecated('Use superboardSupportInitializeAuthenticated.')
final opengrowSupportInitializeAuthenticated =
    superboardSupportInitializeAuthenticated;
@Deprecated('Use superboardSupportListConversationsJson.')
final opengrowSupportListConversationsJson =
    superboardSupportListConversationsJson;
@Deprecated('Use superboardSupportMessagesJson.')
final opengrowSupportMessagesJson = superboardSupportMessagesJson;
@Deprecated('Use superboardSupportSendAdvanced.')
final opengrowSupportSendAdvanced = superboardSupportSendAdvanced;
@Deprecated('Use superboardSupportUploadAttachmentJson.')
final opengrowSupportUploadAttachmentJson =
    superboardSupportUploadAttachmentJson;
@Deprecated('Use superboardSupportConnectRealtime.')
final opengrowSupportConnectRealtime = superboardSupportConnectRealtime;
@Deprecated('Use superboardSupportMarkRead.')
final opengrowSupportMarkRead = superboardSupportMarkRead;

// Additional aliases retained for the old Support/Messaging facade. They are
// package compatibility only and are not added to the SuperBoard FF Library.
@Deprecated('Use superboardSupportOpenConversation.')
final opengrowSupportOpenConversation = superboardSupportOpenConversation;
@Deprecated('Use superboardSupportGetConfigurationJson.')
final opengrowSupportGetConfigurationJson =
    superboardSupportGetConfigurationJson;
@Deprecated('Use superboardSupportUpdateConversationJson.')
final opengrowSupportUpdateConversationJson =
    superboardSupportUpdateConversationJson;
@Deprecated('Use superboardSupportSend.')
final opengrowSupportSend = superboardSupportSend;
@Deprecated('Use superboardSupportSubmitCsatJson.')
final opengrowSupportSubmitCsatJson = superboardSupportSubmitCsatJson;
@Deprecated('Use superboardSupportDownloadAttachment.')
final opengrowSupportDownloadAttachment = superboardSupportDownloadAttachment;
@Deprecated('Use superboardSupportSendAttachment.')
final opengrowSupportSendAttachment = superboardSupportSendAttachment;
@Deprecated('Use superboardSupportSetTyping.')
final opengrowSupportSetTyping = superboardSupportSetTyping;
@Deprecated('Use superboardSupportDisconnectRealtime.')
final opengrowSupportDisconnectRealtime = superboardSupportDisconnectRealtime;
@Deprecated('Use superboardSupportGetLastRealtimeEventJson.')
final opengrowSupportGetLastRealtimeEventJson =
    superboardSupportGetLastRealtimeEventJson;
@Deprecated('Use superboardSupportDispose.')
final opengrowSupportDispose = superboardSupportDispose;

@Deprecated('Use superboardMessagingInitializeAuthenticated.')
final opengrowMessagingInitializeAuthenticated =
    superboardMessagingInitializeAuthenticated;
@Deprecated('Use superboardMessagingOpenConversation.')
final opengrowMessagingOpenConversation = superboardMessagingOpenConversation;
@Deprecated('Use superboardMessagingGetConfigurationJson.')
final opengrowMessagingGetConfigurationJson =
    superboardMessagingGetConfigurationJson;
@Deprecated('Use superboardMessagingListConversationsJson.')
final opengrowMessagingListConversationsJson =
    superboardMessagingListConversationsJson;
@Deprecated('Use superboardMessagingUpdateConversationJson.')
final opengrowMessagingUpdateConversationJson =
    superboardMessagingUpdateConversationJson;
@Deprecated('Use superboardMessagingMessagesJson.')
final opengrowMessagingMessagesJson = superboardMessagingMessagesJson;
@Deprecated('Use superboardMessagingSend.')
final opengrowMessagingSend = superboardMessagingSend;
@Deprecated('Use superboardMessagingSendAdvanced.')
final opengrowMessagingSendAdvanced = superboardMessagingSendAdvanced;
@Deprecated('Use superboardMessagingSubmitCsatJson.')
final opengrowMessagingSubmitCsatJson = superboardMessagingSubmitCsatJson;
@Deprecated('Use superboardMessagingUploadAttachmentJson.')
final opengrowMessagingUploadAttachmentJson =
    superboardMessagingUploadAttachmentJson;
@Deprecated('Use superboardMessagingDownloadAttachment.')
final opengrowMessagingDownloadAttachment =
    superboardMessagingDownloadAttachment;
@Deprecated('Use superboardMessagingSendAttachment.')
final opengrowMessagingSendAttachment = superboardMessagingSendAttachment;
@Deprecated('Use superboardMessagingMarkRead.')
final opengrowMessagingMarkRead = superboardMessagingMarkRead;
@Deprecated('Use superboardMessagingSetTyping.')
final opengrowMessagingSetTyping = superboardMessagingSetTyping;
@Deprecated('Use superboardMessagingConnectRealtime.')
final opengrowMessagingConnectRealtime = superboardMessagingConnectRealtime;
@Deprecated('Use superboardMessagingDisconnectRealtime.')
final opengrowMessagingDisconnectRealtime =
    superboardMessagingDisconnectRealtime;
@Deprecated('Use superboardMessagingGetLastRealtimeEventJson.')
final opengrowMessagingGetLastRealtimeEventJson =
    superboardMessagingGetLastRealtimeEventJson;
@Deprecated('Use superboardMessagingDispose.')
final opengrowMessagingDispose = superboardMessagingDispose;
