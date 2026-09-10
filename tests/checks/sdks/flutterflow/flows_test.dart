import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  tearDown(() async {
    await SuperBoardFlows.dispose();
  });

  test(
    'FlutterFlow actions expose Flows start, reset, fetch and JSON streams',
    () async {
      final events = <String>[];
      await SuperBoardFlows.initialize(
        apiUrl: 'https://board.example/api/v1/flows',
        projectId: 'project_1',
        environment: 'test',
        userId: 'user_1',
        sdkKey: 'environment-secret',
        realtime: false,
        storage: SuperBoardMemoryFlowStorage(),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/blocks')) {
            return http.Response(
              jsonEncode({
                'blocks': [_slotBlock()],
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/workflows')) {
            return http.Response(
              '{"workflows":[{"id":"workflow_1","workflow_status":"enabled","frequency":"once","user_state":"not-started"}]}',
              200,
            );
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          events.add(body['name'].toString());
          return http.Response(
            '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
            200,
          );
        }),
      );

      expect(
        jsonDecode(superboardFlowsCurrentSlotBlocksJson('dashboard')),
        hasLength(1),
      );
      expect(jsonDecode(await superboardFlowsFetchWorkflowsJson()), {
        'workflows': [
          {
            'id': 'workflow_1',
            'workflow_status': 'enabled',
            'frequency': 'once',
            'user_state': 'not-started',
          },
        ],
      });
      expect(await superboardFlowsStartWorkflow('manual_start'), isTrue);
      expect(await superboardFlowsResetWorkflowProgress('workflow_1'), isTrue);
      expect(events, ['workflow-start', 'reset-progress']);
    },
  );

  testWidgets('FlutterFlow slot delegates to the native renderer', (
    tester,
  ) async {
    await SuperBoardFlows.initialize(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'test',
      userId: 'user_1',
      realtime: false,
      storage: SuperBoardMemoryFlowStorage(),
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_slotBlock()],
            }),
            200,
          );
        }
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SuperBoardFlutterFlowFlowsSlot(slotId: 'dashboard'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();

    expect(find.text('FlutterFlow native Flow'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await SuperBoardFlows.dispose();
  });

  testWidgets('FlutterFlow overlay renders floating native blocks', (
    tester,
  ) async {
    await SuperBoardFlows.initialize(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'test',
      userId: 'user_1',
      realtime: false,
      storage: SuperBoardMemoryFlowStorage(),
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_floatingBlock()],
            }),
            200,
          );
        }
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SuperBoardFlutterFlowFlowsOverlay(width: 600, height: 400),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();

    expect(find.text('FlutterFlow native Flow'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await SuperBoardFlows.dispose();
  });

  testWidgets('FlutterFlow anchor exposes geometry and explicit click action', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: SuperBoardFlutterFlowFlowAnchor(
              anchorName: 'profile-target',
              width: 120,
              height: 48,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      SuperBoardFlowAnchors.instance.rectFor('profile-target')?.size,
      const Size(120, 48),
    );
    final interaction = SuperBoardFlowAnchors.instance.interactions.first;
    expect(
      await superboardFlowsNotifyAnchorInteraction('profile-target'),
      isTrue,
    );
    expect(await interaction, 'profile-target');
  });
}

Map<String, dynamic> _slotBlock() => {
  'id': 'card_1',
  'blockStateId': 'state_card_1',
  'workflowId': 'workflow_1',
  'key': 'card',
  'type': 'component',
  'componentType': 'BasicsV2Card',
  'data': {'title': 'FlutterFlow native Flow'},
  'propertyMeta': [],
  'exitNodes': ['continue'],
  'slottable': true,
  'slotId': 'dashboard',
  'slotIndex': 0,
};

Map<String, dynamic> _floatingBlock() {
  final block = _slotBlock();
  block['slottable'] = false;
  block.remove('slotId');
  block.remove('slotIndex');
  return block;
}
