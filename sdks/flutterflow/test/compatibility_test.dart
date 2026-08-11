// ignore_for_file: deprecated_member_use, deprecated_member_use_from_same_package

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test('exports the 35 reviewed VocoStar OpenGrow function aliases', () {
    final aliases = <Object>[
      opengrowApplicationInitialize,
      opengrowApplicationRestoreSessionJson,
      opengrowApplicationCurrentSessionJson,
      opengrowApplicationAccessToken,
      opengrowApplicationSignInProviderJson,
      opengrowApplicationSignInPasswordJson,
      opengrowApplicationSignInAnonymousJson,
      opengrowApplicationRefreshJson,
      opengrowApplicationLogoutJson,
      opengrowApplicationDeleteAccountJson,
      opengrowPurchaseLogout,
      opengrowApplicationRuntimePolicyJson,
      opengrowApplicationListFilesJson,
      opengrowApplicationUploadFileJson,
      opengrowApplicationDownloadFile,
      opengrowApplicationDeleteFileJson,
      opengrowSetPushToken,
      opengrowPurchaseLogin,
      opengrowPurchase,
      opengrowRestore,
      opengrowGetCustomerInfoJson,
      opengrowGetVirtualCurrenciesJson,
      opengrowApplicationMarketingPreferencesJson,
      opengrowApplicationUpdateMarketingConsentJson,
      opengrowApplicationCreateCustomJobJson,
      opengrowApplicationListCustomJobsJson,
      opengrowApplicationGetCustomJobJson,
      opengrowApplicationCancelCustomJobJson,
      opengrowSupportInitializeAuthenticated,
      opengrowSupportListConversationsJson,
      opengrowSupportMessagesJson,
      opengrowSupportSendAdvanced,
      opengrowSupportUploadAttachmentJson,
      opengrowSupportConnectRealtime,
      opengrowSupportMarkRead,
    ];

    expect(aliases, hasLength(35));
    expect(const OpenGrowOnboarding(), isA<SuperBoardOnboarding>());
  });
}
