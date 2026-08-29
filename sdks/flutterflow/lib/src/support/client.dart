// ignore_for_file: deprecated_member_use

/// Compatibility import for FlutterFlow projects that referenced the previous
/// location. The implementation is owned by the core Flutter SDK.
library;

import 'package:superboard_flutter/superboard_support.dart'
    show SuperBoardSupportIdentityTokenProvider;

export 'package:superboard_flutter/superboard_support.dart'
    show
        SuperBoardSupportIdentityTokenProvider,
        SuperBoardMessagingClient,
        SuperBoardMessagingException,
        SuperBoardSupportClient,
        SuperBoardSupportException,
        maxAttachmentBytes,
        maxSupportAttachmentBytes,
        maxSupportMessageBodyBytes;

@Deprecated('Use SuperBoardSupportIdentityTokenProvider.')
typedef SuperBoardIdentityTokenProvider =
    SuperBoardSupportIdentityTokenProvider;
