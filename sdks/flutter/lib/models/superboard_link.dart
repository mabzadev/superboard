class TrackingParams {
  final String? utmCampaign;

  final String? utmSource;

  final String? utmMedium;

  TrackingParams({this.utmCampaign, this.utmSource, this.utmMedium});

  factory TrackingParams.fromMap(Map<String, dynamic> map) {
    return TrackingParams(
      utmCampaign: (map['utm_campaign'] ?? map['campaign'])?.toString(),
      utmSource: (map['utm_source'] ?? map['source'])?.toString(),
      utmMedium: (map['utm_medium'] ?? map['medium'])?.toString(),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'utm_campaign': utmCampaign,
      'utm_source': utmSource,
      'utm_medium': utmMedium,
    };
  }
}

class DeeplinkDetails {
  final String? link;

  final Map<String, dynamic>? data;

  final TrackingParams? tracking;

  DeeplinkDetails({this.link, this.data, this.tracking});

  factory DeeplinkDetails.fromMap(Map<dynamic, dynamic> map) {
    return DeeplinkDetails(
      link: map['link'] as String?,
      data: map['data'] != null ? Map<String, dynamic>.from(map['data']) : null,
      tracking: map['tracking'] != null
          ? TrackingParams.fromMap(Map<String, dynamic>.from(map['tracking']))
          : null,
    );
  }

  Map<String, dynamic> toMap() {
    return {'link': link, 'data': data, 'tracking': tracking?.toMap()};
  }
}

class CustomLinkRedirect {
  final String url;

  final bool openAppIfInstalled;

  CustomLinkRedirect({required this.url, this.openAppIfInstalled = true});

  Map<String, dynamic> toMap() {
    return {'url': url, 'openAppIfInstalled': openAppIfInstalled};
  }
}

class CustomRedirects {
  final CustomLinkRedirect? ios;
  final CustomLinkRedirect? android;
  final CustomLinkRedirect? desktop;

  CustomRedirects({this.ios, this.android, this.desktop});

  Map<String, dynamic> toMap() {
    return {
      'ios': ios?.toMap(),
      'android': android?.toMap(),
      'desktop': desktop?.toMap(),
    };
  }
}

class GenerateLinkParams {
  final String title;

  final String? subtitle;

  final String? imageURL;

  final Map<String, dynamic>? data;

  final List<String>? tags;

  final CustomRedirects? customRedirects;

  final bool? showPreviewIos;

  final bool? showPreviewAndroid;

  final TrackingParams? tracking;

  GenerateLinkParams({
    required this.title,
    this.subtitle,
    this.imageURL,
    this.data,
    this.tags,
    this.customRedirects,
    this.showPreviewIos,
    this.showPreviewAndroid,
    this.tracking,
  });

  Map<String, dynamic> toMap() {
    return {
      'title': title,
      'subtitle': subtitle,
      'imageURL': imageURL,
      'data': data,
      'tags': tags,
      'customRedirects': customRedirects?.toMap(),
      'showPreviewIos': showPreviewIos,
      'showPreviewAndroid': showPreviewAndroid,
      'tracking': tracking?.toMap(),
    };
  }
}

class SuperBoardException implements Exception {
  final String message;
  final String? code;

  SuperBoardException(this.message, {this.code});

  @override
  String toString() =>
      'SuperBoardException: $message${code != null ? ' (code: $code)' : ''}';
}

enum TransactionType {
  buy,

  cancel,

  refund,
}
