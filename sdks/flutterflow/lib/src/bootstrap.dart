import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:opengrow_flutter/opengrow.dart';

import 'actions.dart';

/// One-time bootstrap widget for a FlutterFlow application's initial page.
///
/// Native collection starts from the generated Info.plist/AndroidManifest.xml.
/// This widget initializes verified purchases and forwards every deep link as a
/// JSON string suitable for a FlutterFlow callback.
class OpenGrowBootstrap extends StatefulWidget {
  const OpenGrowBootstrap({
    super.key,
    required this.projectKey,
    this.width,
    this.height,
    this.sdkBaseUrl = 'https://sdk.vocostar.com',
    this.identityToken = '',
    this.onInitialized,
    this.onDeepLinkJson,
    this.onError,
  });

  final String projectKey;
  final double? width;
  final double? height;
  final String sdkBaseUrl;
  final String identityToken;
  final Future<void> Function()? onInitialized;
  final Future<void> Function(String value)? onDeepLinkJson;
  final Future<void> Function(String message)? onError;

  @override
  State<OpenGrowBootstrap> createState() => _OpenGrowBootstrapState();
}

class _OpenGrowBootstrapState extends State<OpenGrowBootstrap> {
  StreamSubscription<DeeplinkDetails>? _deepLinkSubscription;

  @override
  void initState() {
    super.initState();
    _deepLinkSubscription = OpenGrow().onDeeplinkReceived.listen(
      (details) async {
        final value = jsonEncode(details.toMap());
        OpenGrowFlutterFlowState.lastDeepLinkJson = value;
        await widget.onDeepLinkJson?.call(value);
      },
      onError: (Object error) async {
        final value = error.toString();
        OpenGrowFlutterFlowState.lastError = value;
        await widget.onError?.call(value);
      },
    );
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      await opengrowInitializeAuto(
        projectKey: widget.projectKey,
        sdkBaseUrl: widget.sdkBaseUrl,
        identityToken: widget.identityToken,
      );
      await widget.onInitialized?.call();
    } catch (error) {
      final value = error.toString();
      OpenGrowFlutterFlowState.lastError = value;
      await widget.onError?.call(value);
    }
  }

  @override
  void dispose() {
    _deepLinkSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(width: widget.width, height: widget.height);
  }
}
