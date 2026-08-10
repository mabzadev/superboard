library;

import 'dart:io';

import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart'
    as library_value_helpers;

import '../generated/application_bindings.dart';
import 'migration.dart';

Future<void> main(List<String> args) async {
  final options = _CliOptions.parse(args);
  final libraryProjectId =
      Platform.environment['FF_LIBRARY_PROJECT_ID']?.trim() ?? '';
  final onboardingPageKey =
      Platform.environment['FF_LIBRARY_OPEN_GROW_ONBOARDING_PAGE_KEY']
          ?.trim() ??
      '';
  if (libraryProjectId.isEmpty) {
    stderr.writeln('Error: FF_LIBRARY_PROJECT_ID is required.');
    exit(64);
  }
  if (onboardingPageKey.isEmpty) {
    stderr.writeln(
      'Error: FF_LIBRARY_OPEN_GROW_ONBOARDING_PAGE_KEY is required.',
    );
    exit(64);
  }
  try {
    await flutterFlowAI(
      (app) {
        buildApplicationConfigurationFor(
          app,
          libraryProjectId: libraryProjectId,
        );
        migrateVocoStarToOpenGrow(
          app,
          libraryProjectId: libraryProjectId,
          onboardingPageKey: onboardingPageKey,
        );
      },
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectId: options.projectId,
      findOrCreate: options.findOrCreate,
      allowNewProject: options.allowNewProject,
      dryRun: options.dryRun,
      commitMessage: options.commitMessage,
    );
  } catch (error) {
    stderr.writeln('Error: ${formatFlutterFlowAIError(error)}');
    exit(1);
  }
}

void buildApplicationConfigurationFor(
  App app, {
  required String libraryProjectId,
  Map<String, String>? environment,
}) {
  final normalizedLibraryProjectId = libraryProjectId.trim();
  if (normalizedLibraryProjectId.isEmpty) {
    throw ArgumentError.value(
      libraryProjectId,
      'libraryProjectId',
      'must not be empty',
    );
  }
  final runtimeEnvironment = environment ?? Platform.environment;
  app.raw((project) {
    for (final binding in openGrowLibraryBindings) {
      library_value_helpers.setLibraryValue(
        project,
        libraryParameterName: binding.name,
        value: resolveOpenGrowLibraryBinding(binding, runtimeEnvironment),
      );
      final configured = project
          .ensureAppSettings()
          .ensureLibrarySettings()
          .libraryValues
          .singleWhere(
            (value) =>
                value.hasParameter() &&
                value.parameter.hasIdentifier() &&
                value.parameter.identifier.name == binding.name,
          );
      configured.parameter.identifier
        ..name = binding.name
        ..key = binding.key
        ..projectId = normalizedLibraryProjectId;
    }
  });
}

String resolveOpenGrowLibraryBinding(
  OpenGrowLibraryBinding binding,
  Map<String, String> environment,
) {
  final secretName = binding.environmentSecret?.trim() ?? '';
  if (secretName.isNotEmpty) {
    final value = environment[secretName]?.trim() ?? '';
    if (value.isEmpty) {
      throw StateError('$secretName is required for ${binding.name}.');
    }
    return value;
  }
  final value = binding.value;
  if (value == null) {
    throw StateError('${binding.name} has no literal or environment source.');
  }
  return value;
}

final class _CliOptions {
  const _CliOptions({
    this.apiKey,
    this.baseUrl,
    this.projectName,
    this.projectId,
    this.findOrCreate = false,
    this.allowNewProject = false,
    this.dryRun = false,
    this.commitMessage,
  });

  final String? apiKey;
  final String? baseUrl;
  final String? projectName;
  final String? projectId;
  final bool findOrCreate;
  final bool allowNewProject;
  final bool dryRun;
  final String? commitMessage;

  factory _CliOptions.parse(List<String> args) {
    String? apiKey;
    String? baseUrl;
    String? projectName;
    String? projectId;
    String? commitMessage;
    var findOrCreate = false;
    var allowNewProject = false;
    var dryRun = false;

    String valueAt(int index, String flag) {
      if (index >= args.length) {
        throw FormatException('Missing value for $flag.');
      }
      return args[index];
    }

    for (var i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--api-key':
          apiKey = valueAt(++i, '--api-key');
        case '--base-url':
          baseUrl = valueAt(++i, '--base-url');
        case '--project-name':
          projectName = valueAt(++i, '--project-name');
        case '--project-id':
          projectId = valueAt(++i, '--project-id');
        case '--commit-message':
          commitMessage = valueAt(++i, '--commit-message');
        case '--find-or-create':
          findOrCreate = true;
        case '--allow-new-project':
          allowNewProject = true;
        case '--dry-run':
          dryRun = true;
        default:
          throw FormatException('Unknown option: ${args[i]}');
      }
    }
    return _CliOptions(
      apiKey: apiKey,
      baseUrl: baseUrl,
      projectName: projectName,
      projectId: projectId,
      findOrCreate: findOrCreate,
      allowNewProject: allowNewProject,
      dryRun: dryRun,
      commitMessage: commitMessage,
    );
  }
}
