import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import type { FlowGraph, FlowQueueEvent } from "@superboard/contracts/flows";
import { describe, expect, it } from "vitest";
import type { FlowUserRuntime } from "../src/index";
import type { FlowRuntimeCommand } from "../src/types";

const userHash = "a".repeat(64);

describe("FlowUserRuntime durability", () => {
  it("retries a persisted Delay start when Workflow creation first fails", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-start-retry");

    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      let attempts = 0;
      let fail = true;
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create() {
          attempts += 1;
          if (fail) throw new Error("temporary Workflow control-plane failure");
          return { id: "started" };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];

      try {
        const command = delayCommand("delay-retry-event");
        const first = await instance.execute(command);
        expect(first.duplicate).toBe(false);
        expect(attempts).toBe(1);
        expect(delayStartState(state)).toMatchObject({
          status: "scheduled",
          start_attempt_count: 1,
          execution_started_at: null,
        });
        expect(await state.storage.getAlarm()).not.toBeNull();

        fail = false;
        const duplicate = await instance.execute(command);
        expect(duplicate.duplicate).toBe(true);
        expect(attempts).toBe(2);
        expect(delayStartState(state)).toMatchObject({
          status: "scheduled",
          start_attempt_count: 2,
        });
        expect(delayStartState(state)?.execution_started_at).not.toBeNull();
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("starts a fresh Workflow attempt after a terminal Delay execution lease expires", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-terminal-recovery");
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const ids: string[] = [];
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string }) {
          ids.push(options.id);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];
      try {
        await instance.execute(delayCommand("terminal-delay-event"));
        expect(ids).toHaveLength(1);
        state.storage.sql.exec(
          `UPDATE runtime_delays SET recovery_at = '2020-01-01T00:00:00.000Z'
           WHERE id = 'terminal-delay-event:delay:delay'`,
        );
        await instance.alarm();
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
        expect(ids.every((id) =>
          id.length <= 100 && /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/u.test(id)
        )).toBe(true);
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("re-arms the next leased Delay recovery after an earlier alarm fires", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-multiple-recovery-alarms");
    const nextRecovery = "2030-05-01T12:00:00.000Z";
    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO runtime_delays
          (id, workflow_id, workflow_version_id, block_id, target_block_id,
           status, execution_started_at, recovery_at, created_at, resumed_at)
         VALUES
          ('already-resumed', 'first', 'v1', 'delay-a', 'end-a', 'resumed',
           '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z',
           '2026-01-01T03:00:00.000Z'),
          ('future-lease', 'second', 'v1', 'delay-b', 'end-b', 'scheduled',
           '2030-05-01T09:00:00.000Z', ?, '2030-05-01T09:00:00.000Z', NULL)`,
        nextRecovery,
      );
      await state.storage.deleteAlarm();
      await instance.alarm();
      expect(await state.storage.getAlarm()).toBe(Date.parse(nextRecovery));
    });
  });

  it("compacts old delivered receipts while preserving pending work", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("runtime-compaction");
    await runInDurableObject(stub, async (instance, state) => {
      const old = "2020-01-01T00:00:00.000Z";
      const event = queueEvent("old-delivered", "environment-a");
      state.storage.sql.exec(
        `INSERT INTO runtime_idempotency
          (event_id, workflow_id, response_json, created_at)
         VALUES ('old-idempotency', 'workflow', '{}', ?)`,
        old,
      );
      state.storage.sql.exec(
        `INSERT INTO runtime_outbox
          (event_id, payload_json, status, attempt_count, created_at, delivered_at)
         VALUES ('old-delivered', ?, 'delivered', 1, ?, ?),
                ('old-pending', ?, 'pending', 0, ?, NULL)`,
        JSON.stringify(event),
        old,
        old,
        JSON.stringify({ ...event, eventId: "old-pending" }),
        old,
      );
      state.storage.sql.exec(
        `INSERT INTO runtime_delays
          (id, workflow_id, workflow_version_id, block_id, target_block_id,
           status, created_at, resumed_at)
         VALUES ('old-resumed', 'workflow', 'version', 'delay', 'target',
           'resumed', ?, ?)`,
        old,
        old,
      );

      (instance as unknown as { compactRuntimeStorage(now: number): void })
        .compactRuntimeStorage(Date.now());

      expect(state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM runtime_idempotency",
      ).one().count).toBe(0);
      expect(state.storage.sql.exec<{ event_id: string }>(
        "SELECT event_id FROM runtime_outbox",
      ).toArray()).toEqual([{ event_id: "old-pending" }]);
      expect(state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM runtime_delays",
      ).one().count).toBe(0);
    });
  });

  it("schedules another alarm when more than one outbox page remains", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("outbox-pagination");
    await runInDurableObject(stub, async (instance, state) => {
      const createdAt = new Date().toISOString();
      for (let index = 0; index < 101; index += 1) {
        const event = queueEvent(`bulk-${index}`, "environment-a");
        state.storage.sql.exec(
          `INSERT INTO runtime_outbox
            (event_id, payload_json, status, attempt_count, created_at)
           VALUES (?, ?, 'pending', 0, ?)`,
          event.eventId,
          JSON.stringify(event),
          createdAt,
        );
      }
      await instance.alarm();
      expect(outboxCount(state, "delivered")).toBe(100);
      expect(outboxCount(state, "pending")).toBe(1);
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(outboxCount(state, "delivered")).toBe(101);
      expect(outboxCount(state, "pending")).toBe(0);
    });
  });

  it("names reset events uniquely for two environments", async () => {
    const first = await resetEventId("reset-environment-a", "environment-a");
    const second = await resetEventId("reset-environment-b", "environment-b");
    expect(first).toBe("shared-reset:environment-a:workflow-reset");
    expect(second).toBe("shared-reset:environment-b:workflow-reset");
    expect(first).not.toBe(second);
  });

  it("replays a reset receipt without deleting progress created after the reset", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("reset-idempotency");
    const initial: FlowRuntimeCommand = {
      event: {
        ...queueEvent("before-reset", "environment-a", "workflow-reset"),
        name: "identify",
      },
      graph: componentGraph(),
      frequency: "once",
      migrationStrategy: "finish-current",
      userProperties: {},
    };
    await stub.execute(initial);
    const command = {
      eventId: "stable-reset-command",
      projectId: 11,
      projectRef: "10-test",
      environmentId: "environment-a",
      userIdHash: userHash,
      workflowIds: ["workflow-reset"],
    };
    expect(await stub.resetProgress(command)).toEqual({ reset: 1 });
    await stub.execute({
      ...initial,
      event: { ...initial.event, eventId: "after-reset" },
    });

    expect(await stub.resetProgress(command)).toEqual({ reset: 1, duplicate: true });
    await runInDurableObject(stub, async (instance) => {
      expect((await instance.getSnapshot("workflow-reset"))?.state).toBe("in-progress");
    });
  });

  it("replays the same runtime command and rejects another payload using its event id", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("runtime-command-idempotency");
    const command: FlowRuntimeCommand = {
      event: {
        ...queueEvent("same-runtime-event", "environment-a", "workflow-command"),
        name: "identify",
      },
      graph: componentGraph(),
      frequency: "once",
      migrationStrategy: "finish-current",
      userProperties: { plan: "pro" },
    };
    const first = await runInDurableObject(stub, (instance) => instance.execute(command));
    const replay = await runInDurableObject(stub, (instance) => instance.execute(command));
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);

    await expect(runInDurableObject(stub, (instance) => instance.execute({
      ...command,
      userProperties: { plan: "free" },
    }))).rejects.toThrow(/flow_runtime_idempotency_conflict/u);
  });

  it("rejects stale or forged block state events without creating an outbox event", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("stale-block-state");
    const initial = await runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("activate-cycle-one", "environment-a", "workflow-state"),
        name: "identify",
      },
      graph: componentGraph(),
      frequency: "every-time",
      migrationStrategy: "finish-current",
      userProperties: {},
    }));
    const firstStateId = initial.updatedBlocks[0]!.blockStateId!;
    const before = await runInDurableObject(stub, async (_instance, state) =>
      outboxCount(state, "delivered") + outboxCount(state, "pending")
    );
    await expect(runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("forged-transition", "environment-a", "workflow-state"),
        name: "transition",
        blockId: "card",
        blockStateId: "forged-state",
        propertyKey: "dismiss",
      },
      graph: componentGraph(),
      frequency: "every-time",
      migrationStrategy: "finish-current",
      userProperties: {},
    }))).rejects.toThrow(/flow_runtime_block_state_stale/u);
    const after = await runInDurableObject(stub, async (_instance, state) =>
      outboxCount(state, "delivered") + outboxCount(state, "pending")
    );
    expect(after).toBe(before);

    await runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("complete-cycle-one", "environment-a", "workflow-state"),
        name: "transition",
        blockId: "card",
        blockStateId: firstStateId,
        propertyKey: "dismiss",
      },
      graph: componentGraph(),
      frequency: "every-time",
      migrationStrategy: "finish-current",
      userProperties: {},
    }));
    const second = await runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("activate-cycle-two", "environment-a", "workflow-state"),
        name: "identify",
      },
      graph: componentGraph(),
      frequency: "every-time",
      migrationStrategy: "finish-current",
      userProperties: {},
    }));
    expect(second.updatedBlocks[0]!.blockStateId).not.toBe(firstStateId);
    await expect(runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("late-cycle-one", "environment-a", "workflow-state"),
        name: "transition",
        blockId: "card",
        blockStateId: firstStateId,
        propertyKey: "dismiss",
      },
      graph: componentGraph(),
      frequency: "every-time",
      migrationStrategy: "finish-current",
      userProperties: {},
    }))).rejects.toThrow(/flow_runtime_block_state_stale/u);
  });

  it("persists and starts a chained Delay and projects the resumed state", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("chained-delay");
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const started: Array<{ id: string; params: unknown }> = [];
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string; params: unknown }) {
          started.push(options);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];

      try {
        const command: FlowRuntimeCommand = {
          ...delayCommand("delay-chain-event"),
          graph: chainedDelayGraph(),
        };
        const first = await instance.execute(command);
        expect(first.activeBlockIds).toEqual(["delay-one"]);
        expect(started).toHaveLength(1);
        const firstPayload = started[0]!.params as import("../src/types").FlowDelayPayload;

        const resumed = await instance.resumeDelay(firstPayload);
        expect(resumed?.activeBlockIds).toEqual(["delay-two"]);
        expect(started).toHaveLength(2);
        expect(
          state.storage.sql.exec<{ status: string }>(
            "SELECT status FROM runtime_delays ORDER BY created_at, id",
          ).toArray(),
        ).toEqual([{ status: "resumed" }, { status: "scheduled" }]);

        const resumeEvent = state.storage.sql.exec<{ payload_json: string }>(
          "SELECT payload_json FROM runtime_outbox WHERE event_id = ?",
          "delay-chain-event:resume:delay-one",
        ).one();
        expect(JSON.parse(resumeEvent.payload_json)).toMatchObject({
          properties: {
            __runtime_state: {
              state: "in-progress",
              activeBlockIds: ["delay-two"],
            },
          },
        });
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("continues Workflow Triggers in both directions after Delay wake-ups without HTTP polling", async () => {
    const projectId = 91_101;
    const environmentId = "runtime-trigger-environment";
    const targetWorkflowId = "runtime-trigger-target";
    const targetGraph = delayedManualTargetGraph();
    await seedRuntimeRelease(projectId, environmentId, targetWorkflowId, targetGraph);
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-workflow-trigger-chain");
    await runInDurableObject(stub, async (instance) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const started: Array<{ id: string; params: unknown }> = [];
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string; params: unknown }) {
          started.push(options);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];
      try {
        const parentWorkflowId = "runtime-trigger-parent";
        const parent = await instance.execute({
          event: {
            ...queueEvent("trigger-parent-start", environmentId, parentWorkflowId),
            projectId,
            projectRef: `${projectId}-test`,
          },
          graph: delayedTriggerParentGraph(targetWorkflowId),
          frequency: "once",
          migrationStrategy: "finish-current",
          userProperties: {},
        });
        expect(parent.activeBlockIds).toEqual(["parent-delay"]);
        expect(started).toHaveLength(1);

        await instance.resumeDelay(
          started[0]!.params as import("../src/types").FlowDelayPayload,
        );
        expect((await instance.getSnapshot(parentWorkflowId))?.activeBlockIds)
          .toEqual(["parent-trigger"]);
        expect((await instance.getSnapshot(targetWorkflowId))?.activeBlockIds)
          .toEqual(["target-delay"]);
        expect(started).toHaveLength(2);

        await instance.resumeDelay(
          started[1]!.params as import("../src/types").FlowDelayPayload,
        );
        expect((await instance.getSnapshot(targetWorkflowId))?.state).toBe("completed");
        expect((await instance.getSnapshot(parentWorkflowId))?.activeBlockIds)
          .toEqual(["parent-card"]);
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("restarts an already completed every-time trigger target after an asynchronous Delay", async () => {
    const projectId = 91_103;
    const environmentId = "runtime-trigger-every-time-environment";
    const targetWorkflowId = "runtime-trigger-every-time-target";
    const targetGraph = delayedManualTargetGraph();
    await seedRuntimeRelease(
      projectId,
      environmentId,
      targetWorkflowId,
      targetGraph,
      "every-time",
    );
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-trigger-every-time-restart");
    await runInDurableObject(stub, async (instance) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const started: Array<{ id: string; params: unknown }> = [];
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string; params: unknown }) {
          started.push(options);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];
      try {
        const base = {
          projectId,
          projectRef: `${projectId}-test`,
          environmentId,
          userIdHash: userHash,
        };
        const completedTarget = await instance.execute({
          event: {
            ...queueEvent("every-time-target-first-start", environmentId, targetWorkflowId),
            ...base,
            name: "workflow-start",
            blockKey: "target-manual-start",
          },
          graph: targetGraph,
          frequency: "every-time",
          migrationStrategy: "finish-current",
          userProperties: {},
          resolveTriggers: false,
          reconcileLaunchpad: false,
        });
        expect(completedTarget.activeBlockIds).toEqual(["target-delay"]);
        await instance.resumeDelay(
          started.shift()!.params as import("../src/types").FlowDelayPayload,
        );
        expect((await instance.getSnapshot(targetWorkflowId))?.state).toBe("completed");

        const parentWorkflowId = "runtime-trigger-every-time-parent";
        const parent = await instance.execute({
          event: {
            ...queueEvent("every-time-parent-start", environmentId, parentWorkflowId),
            ...base,
          },
          graph: delayedTriggerParentGraph(targetWorkflowId),
          frequency: "once",
          migrationStrategy: "finish-current",
          userProperties: {},
        });
        expect(parent.activeBlockIds).toEqual(["parent-delay"]);
        await instance.resumeDelay(
          started.shift()!.params as import("../src/types").FlowDelayPayload,
        );
        expect((await instance.getSnapshot(parentWorkflowId))?.activeBlockIds)
          .toEqual(["parent-trigger"]);
        expect((await instance.getSnapshot(targetWorkflowId))?.state).toBe("in-progress");
        expect((await instance.getSnapshot(targetWorkflowId))?.activeBlockIds)
          .toEqual(["target-delay"]);
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("starts the next Launchpad workflow immediately when a transition frees capacity", async () => {
    const projectId = 91_102;
    const environmentId = "runtime-launchpad-environment";
    const firstWorkflowId = "runtime-launchpad-first";
    const nextWorkflowId = "runtime-launchpad-next";
    await seedRuntimeRelease(projectId, environmentId, firstWorkflowId, componentGraph());
    await seedRuntimeRelease(projectId, environmentId, nextWorkflowId, componentGraph());
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO flow_launchpad_groups
          (id, project_id, environment_id, name, position, concurrency_limit, paused)
         VALUES ('runtime-launchpad-group', ?, ?, 'Runtime queue', 0, 1, 0)`,
      ).bind(projectId, environmentId),
      env.DB.prepare(
        `INSERT INTO flow_launchpad_workflows (group_id, workflow_id, priority)
         VALUES ('runtime-launchpad-group', ?, 100)`,
      ).bind(firstWorkflowId),
      env.DB.prepare(
        `INSERT INTO flow_launchpad_workflows (group_id, workflow_id, priority)
         VALUES ('runtime-launchpad-group', ?, 10)`,
      ).bind(nextWorkflowId),
      env.DB.prepare(
        `INSERT INTO flow_launchpad_assignments
          (project_id, environment_id, user_id_hash, workflow_id, group_id)
         VALUES (?, ?, ?, ?, 'runtime-launchpad-group')`,
      ).bind(projectId, environmentId, userHash, firstWorkflowId),
    ]);
    const stub = env.FLOW_USER_RUNTIME.getByName("launchpad-capacity-release");
    const base = {
      projectId,
      projectRef: `${projectId}-test`,
      environmentId,
      userIdHash: userHash,
    };
    const first = await runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("launchpad-first-start", environmentId, firstWorkflowId),
        ...base,
      },
      graph: componentGraph(),
      frequency: "once",
      migrationStrategy: "finish-current",
      userProperties: {},
      resolveTriggers: false,
    }));
    expect(first.state).toBe("in-progress");
    expect(await runInDurableObject(
      stub,
      (instance) => instance.getSnapshot(nextWorkflowId),
    )).toBeNull();

    await runInDurableObject(stub, (instance) => instance.execute({
      event: {
        ...queueEvent("launchpad-first-complete", environmentId, firstWorkflowId),
        ...base,
        name: "transition",
        blockId: "card",
        propertyKey: "default",
      },
      graph: componentGraph(),
      frequency: "once",
      migrationStrategy: "finish-current",
      userProperties: {},
      resolveTriggers: false,
    }));
    expect((await runInDurableObject(
      stub,
      (instance) => instance.getSnapshot(firstWorkflowId),
    ))?.state).toBe("completed");
    expect((await runInDurableObject(
      stub,
      (instance) => instance.getSnapshot(nextWorkflowId),
    ))?.state).toBe("in-progress");
    expect(
      await env.DB.prepare(
        `SELECT group_id FROM flow_launchpad_assignments
         WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?
           AND workflow_id = ?`,
      ).bind(projectId, environmentId, userHash, nextWorkflowId).first(),
    ).toMatchObject({ group_id: "runtime-launchpad-group" });
  });

  it("keeps parallel Delay resumes as distinct durable events", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("parallel-delays");
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const started: Array<{ id: string; params: unknown }> = [];
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string; params: unknown }) {
          started.push(options);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];

      try {
        const command: FlowRuntimeCommand = {
          ...delayCommand("parallel-delay-event"),
          graph: parallelDelayGraph(),
        };
        const initial = await instance.execute(command);
        expect(initial.activeBlockIds).toEqual(["delay-left", "delay-right"]);
        expect(started).toHaveLength(2);
        for (const execution of started.slice()) {
          await instance.resumeDelay(
            execution.params as import("../src/types").FlowDelayPayload,
          );
        }
        const resumeEvents = state.storage.sql.exec<{ event_id: string }>(
          `SELECT event_id FROM runtime_outbox
           WHERE event_id LIKE 'parallel-delay-event:resume:%'
           ORDER BY event_id`,
        ).toArray();
        expect(resumeEvents).toEqual([
          { event_id: "parallel-delay-event:resume:delay-left" },
          { event_id: "parallel-delay-event:resume:delay-right" },
        ]);
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
      }
    });
  });

  it("retries a realtime update after the Hub RPC fails", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("realtime-outbox-retry");
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalHub = runtimeEnv.FLOW_REALTIME_HUB;
      let attempts = 0;
      let fail = true;
      runtimeEnv.FLOW_REALTIME_HUB = {
        getByName() {
          return {
            async broadcast() {
              attempts += 1;
              if (fail) throw new Error("temporary realtime hub failure");
              return 1;
            },
          };
        },
      } as unknown as Cloudflare.Env["FLOW_REALTIME_HUB"];
      try {
        const command: FlowRuntimeCommand = {
          event: {
            ...queueEvent("realtime-event", "environment-a", "workflow-realtime"),
            name: "identify",
          },
          graph: componentGraph(),
          frequency: "once",
          migrationStrategy: "finish-current",
          userProperties: {},
        };
        const first = await instance.execute(command);
        expect(first.duplicate).toBe(false);
        expect(attempts).toBe(1);
        expect(realtimeOutboxCount(state, "pending")).toBe(1);
        expect(await state.storage.getAlarm()).not.toBeNull();

        fail = false;
        const duplicate = await instance.execute(command);
        expect(duplicate.duplicate).toBe(true);
        expect(attempts).toBe(2);
        expect(realtimeOutboxCount(state, "pending")).toBe(0);
        expect(realtimeOutboxCount(state, "delivered")).toBe(1);
      } finally {
        runtimeEnv.FLOW_REALTIME_HUB = originalHub;
      }
    });
  });

  it("retries the committed realtime update when a Delay resume is replayed", async () => {
    const stub = env.FLOW_USER_RUNTIME.getByName("delay-realtime-outbox-retry");
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = (instance as FlowUserRuntime as unknown as {
        env: Cloudflare.Env;
      }).env;
      const originalHub = runtimeEnv.FLOW_REALTIME_HUB;
      const originalWorkflow = runtimeEnv.FLOW_DELAY_EXECUTION;
      const started: Array<{ id: string; params: unknown }> = [];
      let attempts = 0;
      let fail = false;
      runtimeEnv.FLOW_DELAY_EXECUTION = {
        async create(options: { id: string; params: unknown }) {
          started.push(options);
          return { id: options.id };
        },
      } as unknown as Cloudflare.Env["FLOW_DELAY_EXECUTION"];
      runtimeEnv.FLOW_REALTIME_HUB = {
        getByName() {
          return {
            async broadcast() {
              attempts += 1;
              if (fail) throw new Error("temporary realtime hub failure");
              return 1;
            },
          };
        },
      } as unknown as Cloudflare.Env["FLOW_REALTIME_HUB"];
      try {
        await instance.execute(delayCommand("delay-realtime-event"));
        const payload = started[0]!.params as import("../src/types").FlowDelayPayload;
        fail = true;
        const resumed = await instance.resumeDelay(payload);
        expect(resumed).not.toBeNull();
        expect(realtimeOutboxCount(state, "pending")).toBe(1);

        fail = false;
        expect(await instance.resumeDelay(payload)).toBeNull();
        expect(realtimeOutboxCount(state, "pending")).toBe(0);
        expect(realtimeOutboxCount(state, "delivered")).toBe(2);
        expect(attempts).toBeGreaterThanOrEqual(3);
      } finally {
        runtimeEnv.FLOW_DELAY_EXECUTION = originalWorkflow;
        runtimeEnv.FLOW_REALTIME_HUB = originalHub;
      }
    });
  });
});

async function resetEventId(runtimeName: string, environmentId: string) {
  const stub = env.FLOW_USER_RUNTIME.getByName(runtimeName);
  return runInDurableObject(stub, async (instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO runtime_workflows
        (workflow_id, workflow_version_id, state, active_block_ids_json,
         block_state_ids_json, graph_json, user_properties_json, generation,
         updated_at)
       VALUES ('workflow-reset', 'version-1', 'in-progress', '["card"]',
         '{}', ?, '{}', 1, ?)`,
      JSON.stringify(componentGraph()),
      new Date().toISOString(),
    );
    await instance.resetProgress({
      eventId: "shared-reset",
      projectId: 11,
      projectRef: "10-test",
      environmentId,
      userIdHash: userHash,
    });
    return state.storage.sql.exec<{ event_id: string }>(
      `SELECT event_id FROM runtime_outbox
       WHERE event_id LIKE 'shared-reset:%'`,
    ).one().event_id;
  });
}

function delayCommand(eventId: string): FlowRuntimeCommand {
  return {
    event: queueEvent(eventId, "environment-a", "workflow-delay"),
    graph: delayGraph(),
    frequency: "once",
    migrationStrategy: "finish-current",
    userProperties: {},
  };
}

function queueEvent(
  eventId: string,
  environmentId: string,
  workflowId?: string,
): FlowQueueEvent {
  return {
    schemaVersion: 1,
    eventId,
    projectId: 11,
    projectRef: "10-test",
    environmentId,
    userIdHash: userHash,
    name: "identify",
    occurredAt: new Date().toISOString(),
    ...(workflowId ? { workflowId, workflowVersionId: "version-1" } : {}),
  };
}

function delayGraph(): FlowGraph {
  const graph = componentGraph();
  graph.blocks.splice(1, 0, {
    id: "delay",
    key: "delay",
    type: "delay",
    name: "Delay",
    data: { minutes: 5 },
    propertyMeta: [],
    exitNodes: ["default"],
    position: { x: 160, y: 0 },
  });
  graph.paths[0]!.targetBlockId = "delay";
  graph.paths.push({
    id: "delay-card",
    sourceBlockId: "delay",
    sourceExitNode: "default",
    targetBlockId: "card",
  });
  return graph;
}

function componentGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: "start",
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 0 },
      },
      {
        id: "card",
        key: "card",
        type: "component",
        name: "Card",
        componentType: "card",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 320, y: 0 },
      },
    ],
    paths: [{
      id: "start-card",
      sourceBlockId: "start",
      sourceExitNode: "default",
      targetBlockId: "card",
    }],
  };
}

function chainedDelayGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: "start",
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 0 },
      },
      ...["one", "two"].map((suffix, index) => ({
        id: `delay-${suffix}`,
        key: `delay-${suffix}`,
        type: "delay" as const,
        name: `Delay ${suffix}`,
        data: { minutes: 5 },
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 160 + index * 160, y: 0 },
      })),
      {
        id: "card",
        key: "card",
        type: "component",
        name: "Card",
        componentType: "card",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 480, y: 0 },
      },
    ],
    paths: [
      {
        id: "start-delay-one",
        sourceBlockId: "start",
        sourceExitNode: "default",
        targetBlockId: "delay-one",
      },
      {
        id: "delay-one-two",
        sourceBlockId: "delay-one",
        sourceExitNode: "default",
        targetBlockId: "delay-two",
      },
      {
        id: "delay-two-card",
        sourceBlockId: "delay-two",
        sourceExitNode: "default",
        targetBlockId: "card",
      },
    ],
  };
}

function parallelDelayGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: "start",
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 0 },
      },
      ...["left", "right"].map((side, index) => ({
        id: `delay-${side}`,
        key: `delay-${side}`,
        type: "delay" as const,
        name: `Delay ${side}`,
        data: { minutes: 5 },
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 160, y: index * 160 },
      })),
      ...["left", "right"].map((side, index) => ({
        id: `card-${side}`,
        key: `card-${side}`,
        type: "component" as const,
        name: `Card ${side}`,
        componentType: "card",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 320, y: index * 160 },
      })),
    ],
    paths: [
      ...["left", "right"].map((side) => ({
        id: `start-delay-${side}`,
        sourceBlockId: "start",
        sourceExitNode: "default",
        targetBlockId: `delay-${side}`,
      })),
      ...["left", "right"].map((side) => ({
        id: `delay-card-${side}`,
        sourceBlockId: `delay-${side}`,
        sourceExitNode: "default",
        targetBlockId: `card-${side}`,
      })),
    ],
  };
}

function delayedTriggerParentGraph(targetWorkflowId: string): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      editorBlock("parent-start", "start"),
      editorBlock("parent-delay", "delay", { minutes: 1 }),
      editorBlock("parent-trigger", "workflow-trigger", {
        workflowId: targetWorkflowId,
        blockKey: "target-manual-start",
      }),
      {
        ...editorBlock("parent-card", "component"),
        componentType: "card",
      },
    ],
    paths: [
      flowPath("parent-start", "parent-delay"),
      flowPath("parent-delay", "parent-trigger"),
      flowPath("parent-trigger", "parent-card", "workflow_completed"),
    ],
  };
}

function delayedManualTargetGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      {
        ...editorBlock("target-manual", "manual-start"),
        key: "target-manual-start",
      },
      editorBlock("target-delay", "delay", { minutes: 1 }),
      editorBlock("target-end", "end"),
    ],
    paths: [
      flowPath("target-manual", "target-delay"),
      flowPath("target-delay", "target-end"),
    ],
  };
}

function editorBlock(
  id: string,
  type: FlowGraph["blocks"][number]["type"],
  data: Record<string, unknown> = {},
): FlowGraph["blocks"][number] {
  return {
    id,
    key: id,
    type,
    name: id,
    data,
    propertyMeta: [],
    exitNodes: type === "workflow-trigger"
      ? ["workflow_completed"]
      : ["default"],
    position: { x: 0, y: 0 },
  };
}

function flowPath(
  sourceBlockId: string,
  targetBlockId: string,
  sourceExitNode = "default",
): FlowGraph["paths"][number] {
  return {
    id: `${sourceBlockId}-${sourceExitNode}-${targetBlockId}`,
    sourceBlockId,
    sourceExitNode,
    targetBlockId,
  };
}

async function seedRuntimeRelease(
  projectId: number,
  environmentId: string,
  workflowId: string,
  graph: FlowGraph,
  frequency: "once" | "every-time" = "once",
): Promise<void> {
  const projectRef = `${projectId}-test`;
  const versionId = `${workflowId}-version`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO flow_projects
        (project_id, project_ref, sdk_identifier, created_by)
       VALUES (?, ?, ?, 'runtime-test')`,
    ).bind(projectId, projectRef, `runtime-sdk-${projectId}`),
    env.DB.prepare(
      `INSERT OR IGNORE INTO flow_environments
        (id, project_id, name, key, kind, sdk_key_hash)
       VALUES (?, ?, 'Runtime', 'test', 'test', 'runtime-test-key')`,
    ).bind(environmentId, projectId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO flow_workflows
        (id, project_id, identifier, name, frequency, status, origin, created_by)
       VALUES (?, ?, ?, ?, ?, 'active', 'flows', 'runtime-test')`,
    ).bind(workflowId, projectId, workflowId, workflowId, frequency),
    env.DB.prepare(
      `INSERT OR IGNORE INTO flow_workflow_versions
        (id, project_id, workflow_id, version, graph_json, checksum_sha256,
         migration_strategy, published_by)
       VALUES (?, ?, ?, 1, ?, ?, 'finish-current', 'runtime-test')`,
    ).bind(versionId, projectId, workflowId, JSON.stringify(graph), "0".repeat(64)),
    env.DB.prepare(
      `INSERT OR REPLACE INTO flow_environment_releases
        (project_id, environment_id, workflow_id, workflow_version_id,
         use_draft, active, activated_by)
       VALUES (?, ?, ?, ?, 0, 1, 'runtime-test')`,
    ).bind(projectId, environmentId, workflowId, versionId),
  ]);
}

function delayStartState(state: DurableObjectState) {
  return state.storage.sql.exec<{
    status: string;
    start_attempt_count: number;
    execution_started_at: string | null;
  }>(
    `SELECT status, start_attempt_count, execution_started_at
     FROM runtime_delays LIMIT 1`,
  ).one();
}

function outboxCount(state: DurableObjectState, status: string): number {
  return state.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) AS count FROM runtime_outbox WHERE status = ?",
    status,
  ).one().count;
}

function realtimeOutboxCount(state: DurableObjectState, status: string): number {
  return state.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) AS count FROM runtime_realtime_outbox WHERE status = ?",
    status,
  ).one().count;
}
