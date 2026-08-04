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
    this.appVersion = '',
    this.buildNumber = '',
    this.purchasesSdkVersion = '2.1.3',
    this.initializePurchases = false,
    this.onInitialized,
    this.onDeepLinkJson,
    this.onPurchaseResultJson,
    this.onVerifiedCustomerInfoJson,
    this.onError,
    @visibleForTesting this.purchaseResultStream,
    @visibleForTesting this.customerInfoStream,
  });

  final String projectKey;
  final double? width;
  final double? height;
  final String sdkBaseUrl;
  final String identityToken;
  final String appVersion;
  final String buildNumber;
  final String purchasesSdkVersion;

  /// Set to false when the host app initializes Purchases after its own
  /// authentication flow with [opengrowInitializeAuthenticated].
  final bool initializePurchases;
  final Future<void> Function()? onInitialized;
  final Future<void> Function(String value)? onDeepLinkJson;
  final Future<void> Function(String value)? onPurchaseResultJson;
  final Future<void> Function(String value)? onVerifiedCustomerInfoJson;
  final Future<void> Function(String message)? onError;
  final Stream<OpenGrowPurchaseResult>? purchaseResultStream;
  final Stream<OpenGrowCustomerInfo>? customerInfoStream;

  @override
  State<OpenGrowBootstrap> createState() => _OpenGrowBootstrapState();
}

class _OpenGrowBootstrapState extends State<OpenGrowBootstrap> {
  StreamSubscription<DeeplinkDetails>? _deepLinkSubscription;
  StreamSubscription<OpenGrowPurchaseResult>? _purchaseResultSubscription;
  StreamSubscription<OpenGrowCustomerInfo>? _customerInfoSubscription;

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
    _purchaseResultSubscription =
        (widget.purchaseResultStream ??
                OpenGrowPurchases.instance.purchaseResultStream)
            .listen((result) async {
              final value = jsonEncode(result.toJson());
              OpenGrowFlutterFlowState.lastPurchaseResultJson = value;
              await widget.onPurchaseResultJson?.call(value);
            }, onError: _forwardError);
    _customerInfoSubscription =
        (widget.customerInfoStream ??
                OpenGrowPurchases.instance.customerInfoStream)
            .listen((info) async {
              final value = jsonEncode(info.toJson());
              OpenGrowFlutterFlowState.lastVerifiedCustomerInfoJson = value;
              await widget.onVerifiedCustomerInfoJson?.call(value);
            }, onError: _forwardError);
    _initialize();
  }

  Future<void> _forwardError(Object error) async {
    final value = error.toString();
    OpenGrowFlutterFlowState.lastError = value;
    await widget.onError?.call(value);
  }

  Future<void> _initialize() async {
    try {
      if (widget.initializePurchases) {
        await opengrowInitializeAuto(
          projectKey: widget.projectKey,
          sdkBaseUrl: widget.sdkBaseUrl,
          identityToken: widget.identityToken,
          appVersion: widget.appVersion,
          buildNumber: widget.buildNumber,
          sdkVersion: widget.purchasesSdkVersion,
        );
      }
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
    _purchaseResultSubscription?.cancel();
    _customerInfoSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(width: widget.width, height: widget.height);
  }
}
