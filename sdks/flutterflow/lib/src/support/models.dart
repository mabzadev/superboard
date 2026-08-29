import 'package:superboard_flutter/superboard_support.dart';

export 'package:superboard_flutter/superboard_support.dart'
    show
        SuperBoardConversation,
        SuperBoardMessage,
        SuperBoardMessageAttachment,
        SuperBoardSupportContact,
        SuperBoardSupportHelpArticle,
        decodeSupportObject;

@Deprecated('Use decodeSupportObject.')
Map<String, dynamic> decodeObject(String value) => decodeSupportObject(value);
