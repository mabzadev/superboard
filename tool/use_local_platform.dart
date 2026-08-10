import 'dart:io';

void main(List<String> arguments) {
  if (arguments.length != 1) {
    stderr.writeln(
      'Usage: dart run tool/use_local_platform.dart /path/to/opengrow-platform',
    );
    exitCode = 64;
    return;
  }
  final platform = Directory(arguments.single).absolute;
  final flutterFlow = Directory('${platform.path}/sdks/flutterflow');
  final messaging = Directory('${platform.path}/sdks/flutterflow_messaging');
  if (!flutterFlow.existsSync() || !messaging.existsSync()) {
    stderr.writeln(
      'The selected directory is not a opengrow-platform checkout.',
    );
    exitCode = 66;
    return;
  }
  File('pubspec_overrides.yaml').writeAsStringSync('''
dependency_overrides:
  opengrow_flutterflow:
    path: ${flutterFlow.path}
  opengrow_flutterflow_messaging:
    path: ${messaging.path}
''');
  stdout.writeln('Local SDK overrides written. Run flutter pub get.');
}
