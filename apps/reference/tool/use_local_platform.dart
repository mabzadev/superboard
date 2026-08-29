import 'dart:io';

void main(List<String> arguments) {
  if (arguments.length != 1) {
    stderr.writeln(
      'Usage: dart run tool/use_local_platform.dart /path/to/superboard',
    );
    exitCode = 64;
    return;
  }
  final platform = Directory(arguments.single).absolute;
  final flutterFlow = Directory('${platform.path}/sdks/flutterflow');
  final flutterSdk = Directory('${platform.path}/sdks/flutter');
  if (!flutterFlow.existsSync() || !flutterSdk.existsSync()) {
    stderr.writeln(
      'The selected directory is not a SuperBoard monorepo checkout.',
    );
    exitCode = 66;
    return;
  }
  File('pubspec_overrides.yaml').writeAsStringSync('''
dependency_overrides:
  superboard_flutterflow:
    path: ${flutterFlow.path}
  superboard_flutter:
    path: ${flutterSdk.path}
''');
  stdout.writeln('Local SDK overrides written. Run flutter pub get.');
}
