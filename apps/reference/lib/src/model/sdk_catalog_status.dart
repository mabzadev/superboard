import 'dart:convert';

class ReferenceSdkEntry {
  const ReferenceSdkEntry({
    required this.id,
    required this.lifecycle,
    required this.packageName,
    required this.baselineVersion,
    required this.sourceVersion,
    required this.catalogueStatus,
    this.candidatePackageName,
  });

  factory ReferenceSdkEntry.fromJson(Map<String, dynamic> value) =>
      ReferenceSdkEntry(
        id: value['id']?.toString() ?? '',
        lifecycle: value['lifecycle']?.toString() ?? '',
        packageName: value['packageName']?.toString() ?? '',
        baselineVersion: value['baselineVersion']?.toString() ?? '',
        sourceVersion: value['sourceVersion']?.toString() ?? '',
        catalogueStatus: value['catalogueStatus']?.toString() ?? '',
        candidatePackageName: value['candidatePackageName']?.toString(),
      );

  final String id;
  final String lifecycle;
  final String packageName;
  final String baselineVersion;
  final String sourceVersion;
  final String catalogueStatus;
  final String? candidatePackageName;

  bool get candidatePending =>
      lifecycle == 'active' && catalogueStatus != 'released';
}

class ReferenceSdkCatalogue {
  const ReferenceSdkCatalogue(this.libraries);

  factory ReferenceSdkCatalogue.parse(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! Map ||
        decoded['schemaVersion'] != 2 ||
        decoded['catalogueSchemaVersion'] != 4 ||
        decoded['libraries'] is! List) {
      throw const FormatException('Unsupported SDK coverage manifest.');
    }
    final libraries = (decoded['libraries'] as List)
        .map((value) {
          if (value is! Map) {
            throw const FormatException('Invalid SDK coverage entry.');
          }
          return ReferenceSdkEntry.fromJson(value.cast<String, dynamic>());
        })
        .toList(growable: false);
    return ReferenceSdkCatalogue(libraries);
  }

  final List<ReferenceSdkEntry> libraries;

  List<ReferenceSdkEntry> get active => libraries
      .where((library) => library.lifecycle == 'active')
      .toList(growable: false);

  bool get promotionReady =>
      active.length == 2 && active.every((library) => !library.candidatePending);

  String get summary =>
      '${active.length} active · v3 ${promotionReady ? 'ready' : 'pending'}';
}
