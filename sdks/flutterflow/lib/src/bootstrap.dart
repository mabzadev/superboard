import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:superboard_flutter/superboard_flutter.dart';

import 'actions.dart';
import 'customer_events.dart';
import 'experience_client.dart';

/// One-time bootstrap widget for a FlutterFlow application's initial page.
///
/// Native collection starts from the generated Info.plist/AndroidManifest.xml.
/// This widget initializes verified purchases and forwards every deep link as a
/// JSON string suitable for a FlutterFlow callback.
class SuperBoardBootstrap extends StatefulWidget {
  const SuperBoardBootstrap({
    super.key,
    required this.projectKey,
    required this.sdkBaseUrl,
    required this.experienceApiBaseUrl,
    this.width,
    this.height,
    this.environment = 'production',
    this.identityToken = '',
    this.appVersion = '',
    this.buildNumber = '',
    this.purchasesSdkVersion = '3.0.0',
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
  final String experienceApiBaseUrl;
  final String environment;
  final String identityToken;
  final String appVersion;
  final String buildNumber;
  final String purchasesSdkVersion;

  /// Set to false when the host app initializes Purchases after its own
  /// authentication flow with [superboardInitializeAuthenticated].
  final bool initializePurchases;
  final Future<void> Function()? onInitialized;
  final Future<void> Function(String value)? onDeepLinkJson;
  final Future<void> Function(String value)? onPurchaseResultJson;
  final Future<void> Function(String value)? onVerifiedCustomerInfoJson;
  final Future<void> Function(String message)? onError;
  final Stream<SuperBoardPurchaseResult>? purchaseResultStream;
  final Stream<SuperBoardCustomerInfo>? customerInfoStream;

  @override
  State<SuperBoardBootstrap> createState() => _SuperBoardBootstrapState();
}

class _SuperBoardBootstrapState extends State<SuperBoardBootstrap> {
  StreamSubscription<DeeplinkDetails>? _deepLinkSubscription;
  StreamSubscription<SuperBoardPurchaseResult>? _purchaseResultSubscription;
  StreamSubscription<SuperBoardCustomerInfo>? _customerInfoSubscription;

  @override
  void initState() {
    super.initState();
    _deepLinkSubscription = SuperBoard().onDeeplinkReceived.listen(
      (details) async {
        final value = jsonEncode(details.toMap());
        SuperBoardFlutterFlowState.lastDeepLinkJson = value;
        await widget.onDeepLinkJson?.call(value);
      },
      onError: (Object error) async {
        final value = error.toString();
        SuperBoardFlutterFlowState.lastError = value;
        await widget.onError?.call(value);
      },
    );
    _purchaseResultSubscription =
        (widget.purchaseResultStream ??
                SuperBoardPurchases.instance.purchaseResultStream)
            .listen((result) async {
              final value = jsonEncode(result.toJson());
              SuperBoardFlutterFlowState.lastPurchaseResultJson = value;
              await widget.onPurchaseResultJson?.call(value);
            }, onError: _forwardError);
    _customerInfoSubscription =
        (widget.customerInfoStream ??
                SuperBoardPurchases.instance.customerInfoStream)
            .listen((info) async {
              final value = jsonEncode(info.toJson());
              SuperBoardFlutterFlowState.lastVerifiedCustomerInfoJson = value;
              await widget.onVerifiedCustomerInfoJson?.call(value);
            }, onError: _forwardError);
    _initialize();
  }

  Future<void> _forwardError(Object error) async {
    final value = error.toString();
    SuperBoardFlutterFlowState.lastError = value;
    await widget.onError?.call(value);
  }

  Future<void> _initialize() async {
    try {
      final platformIdentifier = await SuperBoard().getPlatformIdentifier();
      final platform = switch (defaultTargetPlatform) {
        TargetPlatform.iOS => 'ios',
        TargetPlatform.android => 'android',
        _ => 'web',
      };
      SuperBoardExperienceSdk.configure(
        SuperBoardExperienceClient(
          projectKey: widget.projectKey,
          platform: platform,
          identifier: platformIdentifier,
          environment: widget.environment,
          baseUrl: widget.experienceApiBaseUrl,
        ),
      );
      SuperBoardCustomerEventsSdk.configure(
        SuperBoardCustomerEventsClient(
          projectKey: widget.projectKey,
          platform: platform,
          identifier: platformIdentifier,
          environment: widget.environment,
          baseUrl: widget.experienceApiBaseUrl,
        ),
      );
      if (widget.initializePurchases) {
        await superboardInitializeAuto(
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
      SuperBoardFlutterFlowState.lastError = value;
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
