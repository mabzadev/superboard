import 'package:flutter/material.dart';

import 'src/app.dart';
import 'src/config/reference_config.dart';
import 'src/services/reference_actions.dart';
import 'src/state/reference_state.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final configuration = ReferenceConfig.fromEnvironment();
  final state = ReferenceState(configuration: configuration);
  runApp(
    GrowReferenceApp(
      state: state,
      actions: configuration.liveMode
          ? LiveReferenceActions(configuration: configuration)
          : DemoReferenceActions(),
    ),
  );
}
