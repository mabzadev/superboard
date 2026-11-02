// ignore_for_file: deprecated_member_use

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
