import 'package:flutter/material.dart';
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:superboard_flutter/superboard_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize SuperBoard SDK
  final superboard = SuperBoard();
  try {
    await superboard.setDebugLevel('info');

    // Set user information (optional)
    await superboard.setUserIdentifier('demo-user-123');
    await superboard.setUserAttributes({
      'name': 'Demo User',
      'email': 'demo@example.com',
      'app': 'Flutter Demo',
    });
  } catch (e) {
    debugPrint('Failed to configure SuperBoard: $e');
  }

  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  String _platformVersion = 'Unknown';
  String _generatedLink = '';
  String _lastDeeplinkReceived = 'None';
  final _superboard = SuperBoard();
  StreamSubscription<DeeplinkDetails>? _deeplinkSubscription;
  bool _isGenerating = false;

  @override
  void initState() {
    super.initState();
    initPlatformState();
    setupDeeplinkListener();
  }

  @override
  void dispose() {
    _deeplinkSubscription?.cancel();
    super.dispose();
  }

  void setupDeeplinkListener() {
    _deeplinkSubscription = _superboard.onDeeplinkReceived.listen((
      deeplinkDetails,
    ) {
      setState(() {
        _lastDeeplinkReceived =
            'Link: ${deeplinkDetails.link}\nData: ${deeplinkDetails.data}\nTracking: ${deeplinkDetails.tracking?.toMap()}';
      });

      // Show a dialog when deeplink is received
      if (mounted) {
        // Defer the dialog to the next frame to ensure Material localizations are available
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            showDialog(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Deeplink Received'),
                content: Text(
                  'Link: ${deeplinkDetails.link}\n\nPayload: ${deeplinkDetails.data}',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('OK'),
                  ),
                ],
              ),
            );
          }
        });
      }
    });
  }

  Future<void> initPlatformState() async {
    String platformVersion;
    try {
      platformVersion =
          await _superboard.getPlatformVersion() ?? 'Unknown platform version';
    } on PlatformException {
      platformVersion = 'Failed to get platform version.';
    }

    if (!mounted) return;

    setState(() {
      _platformVersion = platformVersion;
    });
  }

  Future<void> generateLink() async {
    setState(() {
      _isGenerating = true;
    });

    try {
      final link = await _superboard.generateLink(
        GenerateLinkParams(
          title: 'Check out this Flutter app!',
          subtitle: 'Built with SuperBoard SDK',
          imageURL:
              'https://flutter.dev/assets/images/shared/brand/flutter/logo/flutter-lockup.png',
          data: {
            'screen': 'flutter-home',
            'userId': 'demo-user-123',
            'timestamp': DateTime.now().toIso8601String(),
          },
          tags: ['demo', 'flutter'],
          customRedirects: CustomRedirects(
            ios: CustomLinkRedirect(
              url: 'https://google.com/ios',
              openAppIfInstalled: true,
            ),
            android: CustomLinkRedirect(
              url: 'https://google.com/android',
              openAppIfInstalled: false,
            ),
            desktop: CustomLinkRedirect(
              url: 'https://google.com/desktop',
              openAppIfInstalled: false,
            ),
          ),
          showPreviewIos: false,
          showPreviewAndroid: true,
          tracking: TrackingParams(
            utmCampaign: 'spring_sale',
            utmSource: 'newsletter',
            utmMedium: 'email',
          ),
        ),
      );

      if (mounted) {
        setState(() {
          _generatedLink = link;
          _isGenerating = false;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Link generated successfully!')),
        );
      }
    } on SuperBoardException catch (e) {
      if (mounted) {
        setState(() {
          _isGenerating = false;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to generate link: ${e.message}')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData(primarySwatch: Colors.blue, useMaterial3: true),
      home: Scaffold(
        appBar: AppBar(
          title: const Text('SuperBoard Flutter Example'),
          actions: [],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Platform Info',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text('Running on: $_platformVersion'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Generate Link',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _isGenerating ? null : generateLink,
                        child: _isGenerating
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Generate SuperBoard Link'),
                      ),
                      if (_generatedLink.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        const Text(
                          'Generated Link:',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        SelectableText(
                          _generatedLink,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.blue,
                          ),
                        ),
                        const SizedBox(height: 8),
                        ElevatedButton.icon(
                          onPressed: () {
                            Clipboard.setData(
                              ClipboardData(text: _generatedLink),
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Link copied to clipboard!'),
                              ),
                            );
                          },
                          icon: const Icon(Icons.copy),
                          label: const Text('Copy Link'),
                        ),
                        const SizedBox(height: 8),
                        ElevatedButton.icon(
                          onPressed: () async {
                            try {
                              if (await canLaunchUrl(
                                Uri.parse(_generatedLink),
                              )) {
                                await launchUrl(
                                  Uri.parse(_generatedLink),
                                  mode: LaunchMode.externalApplication,
                                );
                              } else {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('Could not launch link'),
                                    ),
                                  );
                                }
                              }
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('Error opening link: $e'),
                                  ),
                                );
                              }
                            }
                          },
                          icon: const Icon(Icons.open_in_browser),
                          label: const Text('Open Link'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Revenue Tracking',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () async {
                          final messenger = ScaffoldMessenger.of(context);
                          try {
                            await _superboard.logCustomPurchase(
                              type: TransactionType.buy,
                              priceInCents: 999,
                              currency: 'USD',
                              productId: 'premium_monthly',
                            );
                            if (mounted) {
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('Custom purchase logged!'),
                                ),
                              );
                            }
                          } on SuperBoardException catch (e) {
                            if (mounted) {
                              messenger.showSnackBar(
                                SnackBar(
                                  content: Text(
                                    'Failed to log purchase: ${e.message}',
                                  ),
                                ),
                              );
                            }
                          }
                        },
                        child: const Text('Log Custom Purchase (\$9.99)'),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Last Deeplink Received',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _lastDeeplinkReceived,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
