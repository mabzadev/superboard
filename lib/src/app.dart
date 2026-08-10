import 'package:flutter/material.dart';

import 'model/reference_feature.dart';
import 'pages/reference_shell.dart';
import 'services/reference_actions.dart';
import 'state/reference_state.dart';

class GrowReferenceApp extends StatelessWidget {
  const GrowReferenceApp({
    super.key,
    required this.state,
    required this.actions,
  });

  final ReferenceState state;
  final ReferenceActions actions;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenGrow Reference',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff5667e8),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff8794ff),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: ReferenceShell(
        state: state,
        actions: actions,
        features: referenceFeatures,
      ),
    );
  }
}
