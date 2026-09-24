import { DurableObject } from "cloudflare:workers";
import type {
  FlowQueueEvent,
  FlowSdkBlock,
  FlowWebSocketMessage,
} from "@superboard/contracts/flows";
import { executeGraph } from "./graph";
import { resolveRuntimeMigration } from "./migration";
import { flowHubName } from "./names";
import { applyMemoryUpdates, transitionMemoryUpdates } from "./state-memory";
import { personalizeValue } from "./targeting";
import { matchesTargeting } from "./targeting";
import { flowWorkflowInstanceId } from "../workflows/instance-id";
import type {
  Env,
  FlowDelayPayload,
  FlowRuntimeCommand,
  FlowRuntimeBootstrapCommand,
  FlowRuntimeResetCommand,
  FlowRuntimeSnapshot,
} from "../types";

type StateRow = {
  workflow_id: string;
  workflow_version_id: string | null;
  state: "not-started" | "in-progress" | "completed" | "stopped";
  active_block_ids_json: string;
  block_state_ids_json: string;
  graph_json: string;
  user_properties_json: string;
  entered_at: string | null;
  exited_at: string | null;
  generation: number;
  revision: number;
};

type OutboxRow = { event_id: string; payload_json: string; attempt_count: number };

type RealtimeOutboxRow = {
  event_id: string;
  project_id: number;
  environment_id: string;
  user_id_hash: string;
  message_json: string;
  attempt_count: number;
};

type DelayStartRow = {
  id: string;
  payload_json: string;
  start_attempt_count: number;
};

const RUNTIME_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export class FlowUserRuntime extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS runtime_workflows (
        workflow_id TEXT PRIMARY KEY,
        workflow_version_id TEXT,
        state TEXT NOT NULL,
        active_block_ids_json TEXT NOT NULL,
        block_state_ids_json TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        user_properties_json TEXT NOT NULL DEFAULT '{}',
        entered_at TEXT,
        exited_at TEXT,
        generation INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_idempotency (
        event_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        command_hash TEXT NOT NULL DEFAULT '',
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (event_id, workflow_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_reset_idempotency (
        event_id TEXT PRIMARY KEY,
        scope_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_outbox (
        event_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_realtime_outbox (
        event_id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        environment_id TEXT NOT NULL,
        user_id_hash TEXT NOT NULL,
        message_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_delays (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        target_block_id TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        start_attempt_count INTEGER NOT NULL DEFAULT 0,
        execution_started_at TEXT,
        recovery_at TEXT,
        created_at TEXT NOT NULL,
        resumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_state_memory (
        workflow_id TEXT NOT NULL,
        property_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, property_key)
      );
      CREATE TABLE IF NOT EXISTS runtime_tours (
        workflow_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        current_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, block_id)
      );
    `);
    this.migrateRuntimeSchema();
  }

  async execute(command: FlowRuntimeCommand): Promise<FlowRuntimeSnapshot> {
    const workflowId = command.event.workflowId;
    if (!workflowId) throw new Error("Flow runtime commands require a workflowId");
    const commandHash = await runtimeCommandHash(command);
    const duplicate = this.readDuplicate(
      command.event.eventId,
      workflowId,
      commandHash,
    );
    if (duplicate) {
      await Promise.all([
        this.startPendingDelays(),
        this.flushOutbox(),
        this.flushRealtimeOutbox(),
      ]);
      this.compactRuntimeStorage();
      return { ...duplicate, duplicate: true };
    }

    const previous = this.readState(workflowId);
    this.assertTargetState(command, previous);
    const requestedVersionId = command.event.workflowVersionId ?? "draft";
    const migration = resolveRuntimeMigration(
      previous
        ? {
            workflowVersionId: previous.workflow_version_id,
            state: previous.state,
          }
        : null,
      requestedVersionId,
      command.migrationStrategy,
      command.frequency,
      command.event.name,
    );
    if (migration.endRuntime && previous) {
      return this.endForMigration(command, previous, commandHash);
    }
    const runtimePrevious = migration.resetRuntime ? null : previous;
    if (
      (runtimePrevious?.state === "completed" || runtimePrevious?.state === "stopped") &&
      command.frequency === "once" &&
      command.event.name !== "reset-progress"
    ) {
      const snapshot = this.snapshotFromState(runtimePrevious, [], true);
      this.persistIdempotency(command.event.eventId, workflowId, commandHash, snapshot);
      return snapshot;
    }

    const now = new Date().toISOString();
    const generation =
      command.event.name === "reset-progress" || migration.resetRuntime
        ? Number(previous?.generation ?? 0) + 1
        : Number(runtimePrevious?.generation ?? 1);
    const revision = migration.resetRuntime
      ? 1
      : Number(runtimePrevious?.revision ?? 0) + 1;
    const stateIds = parseStringMap(runtimePrevious?.block_state_ids_json);
    const previouslyActive = new Set(
      parseStringArray(runtimePrevious?.active_block_ids_json ?? "[]"),
    );
    for (const blockId of Object.keys(stateIds)) {
      if (!previouslyActive.has(blockId)) delete stateIds[blockId];
    }
    const blockStateId = (blockId: string) => {
      const current = stateIds[blockId];
      if (current) return current;
      const created = `${workflowId}:${generation}:${blockId}:${crypto.randomUUID()}`;
      stateIds[blockId] = created;
      return created;
    };

    const storedProperties = runtimePrevious
      ? parseUnknownRecord(runtimePrevious.user_properties_json)
      : this.readLatestUserProperties();
    const userProperties = { ...storedProperties, ...command.userProperties };
    const sameVersion = runtimePrevious?.workflow_version_id === requestedVersionId;
    const useStoredGraph =
      Boolean(runtimePrevious) &&
      (migration.continueStoredVersion ||
        (sameVersion && command.event.name !== "identify"));
    const rawGraph = useStoredGraph && runtimePrevious
      ? (JSON.parse(runtimePrevious.graph_json) as FlowRuntimeCommand["graph"])
      : command.graph;
    const graphSource = personalizeRuntimeGraph(rawGraph, userProperties);
    const versionId =
      migration.continueStoredVersion && runtimePrevious?.workflow_version_id
        ? runtimePrevious.workflow_version_id
        : requestedVersionId;
    let graph = migration.resetRuntime
      ? graphSource
      : this.graphWithStateMemory(workflowId, graphSource);
    const manualMemoryUpdate =
      command.event.name === "set-state-memory" && command.event.propertyKey
        ? [command.event.propertyKey, command.event.properties?.value ?? null] as const
        : null;
    if (manualMemoryUpdate) {
      graph = applyMemoryUpdatesToGraph(graph, new Map([manualMemoryUpdate]));
    }
    const tourIndexes = migration.resetRuntime
      ? {}
      : this.readTourIndexes(workflowId);
    const tourUpdate = readTourUpdate(command, graph);
    if (tourUpdate) tourIndexes[tourUpdate.blockId] = tourUpdate.currentIndex;
    const graphEvent =
      command.event.name === "workflow-exit"
        ? { ...command.event, name: "reset-progress" }
        : command.event;
    const result = executeGraph({
      graph,
      userProperties: {
        ...userProperties,
        __flow_user_id: command.event.userIdHash,
      },
      activeBlockIds: runtimePrevious
        ? parseStringArray(runtimePrevious.active_block_ids_json)
        : [],
      event: graphEvent,
      workflowId,
      blockStateId,
      tourIndexes,
    });
    for (const blockId of result.exitedBlockIds) {
      if (!result.activeBlockIds.includes(blockId)) delete stateIds[blockId];
    }
    const state =
      command.event.name === "reset-progress"
        ? "not-started"
        : command.event.name === "workflow-exit"
          ? "stopped"
          : result.completed
            ? "completed"
            : result.activeBlockIds.length
              ? "in-progress"
              : "not-started";
    const enteredAt =
      state === "in-progress" || state === "completed"
        ? runtimePrevious?.entered_at ?? now
        : null;
    const exitedAt = state === "completed" || state === "stopped" ? now : null;
    const memoryUpdates = transitionMemoryUpdates(graph, result.exitedBlockIds);
    const updatedBlocks = applyMemoryUpdates(result.updatedBlocks, memoryUpdates);

    const snapshot: FlowRuntimeSnapshot = {
      workflowId,
      workflowVersionId: versionId,
      state,
      activeBlockIds: result.activeBlockIds,
      exitedBlockIds: result.exitedBlockIds,
      updatedBlocks,
      ...(enteredAt ? { enteredAt } : {}),
      ...(exitedAt ? { exitedAt } : {}),
      duplicate: false,
    };

    const projectedEvent: FlowQueueEvent = {
      ...command.event,
      workflowVersionId: versionId,
      properties: {
        ...(command.event.properties ?? {}),
        __runtime_state: {
          state: snapshot.state,
          activeBlockIds: snapshot.activeBlockIds,
          enteredAt: snapshot.enteredAt,
          exitedAt: snapshot.exitedAt,
          generation,
          revision,
          tourIndexes,
        },
      },
    };

    const derivedEvents = result.delays
      .filter((delay) => !this.delayExists(command.event.eventId, delay.blockId))
      .map((delay) => ({
        ...projectedEvent,
        eventId: `${command.event.eventId}:delay:${delay.blockId}`,
        name: "enter" as const,
        blockId: delay.blockId,
      }));
    const delayPayloads = result.delays.map((delay) => ({
      delay,
      payload: this.delayPayload(
        {
          ...command,
          event: { ...command.event, workflowVersionId: versionId },
        },
        delay,
      ),
    }));

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO runtime_workflows
          (workflow_id, workflow_version_id, state, active_block_ids_json,
           block_state_ids_json, graph_json, user_properties_json, entered_at,
           exited_at, generation, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET
           workflow_version_id = excluded.workflow_version_id,
           state = excluded.state,
           active_block_ids_json = excluded.active_block_ids_json,
           block_state_ids_json = excluded.block_state_ids_json,
           graph_json = excluded.graph_json,
           user_properties_json = excluded.user_properties_json,
           entered_at = excluded.entered_at,
           exited_at = excluded.exited_at,
           generation = excluded.generation,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
        workflowId,
        versionId,
        state,
        JSON.stringify(result.activeBlockIds),
        JSON.stringify(stateIds),
        JSON.stringify(graph),
        JSON.stringify(userProperties),
        enteredAt,
        exitedAt,
        generation,
        revision,
        now,
      );
      this.insertOutbox(projectedEvent);
      for (const event of derivedEvents) this.insertOutbox(event);
      this.insertRealtimeOutbox(projectedEvent, {
        exitedBlockIds: result.exitedBlockIds,
        updatedBlocks,
      });
      this.persistIdempotency(command.event.eventId, workflowId, commandHash, snapshot);
      if (command.event.name === "reset-progress" || migration.resetRuntime) {
        this.ctx.storage.sql.exec(
          "DELETE FROM runtime_tours WHERE workflow_id = ?",
          workflowId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM runtime_state_memory WHERE workflow_id = ?",
          workflowId,
        );
      } else if (tourUpdate) {
        this.ctx.storage.sql.exec(
          `INSERT INTO runtime_tours
            (workflow_id, block_id, current_index, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workflow_id, block_id) DO UPDATE SET
             current_index = excluded.current_index,
             updated_at = excluded.updated_at`,
          workflowId,
          tourUpdate.blockId,
          tourUpdate.currentIndex,
          now,
        );
      }
      if (manualMemoryUpdate) {
        this.ctx.storage.sql.exec(
          `INSERT INTO runtime_state_memory
            (workflow_id, property_key, value_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workflow_id, property_key) DO UPDATE SET
             value_json = excluded.value_json, updated_at = excluded.updated_at`,
          workflowId,
          manualMemoryUpdate[0],
          JSON.stringify(manualMemoryUpdate[1]),
          now,
        );
      }
      for (const [propertyKey, value] of memoryUpdates) {
        this.ctx.storage.sql.exec(
          `INSERT INTO runtime_state_memory
            (workflow_id, property_key, value_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workflow_id, property_key) DO UPDATE SET
             value_json = excluded.value_json, updated_at = excluded.updated_at`,
          workflowId,
          propertyKey,
          JSON.stringify(value),
          now,
        );
      }
      for (const { delay, payload } of delayPayloads) {
        const delayId = `${command.event.eventId}:delay:${delay.blockId}`;
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO runtime_delays
            (id, workflow_id, workflow_version_id, block_id, target_block_id,
             payload_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
          delayId,
          workflowId,
          versionId,
          delay.blockId,
          delay.targetBlockId,
          JSON.stringify(payload),
          now,
        );
      }
    });

    await Promise.all([
      this.startPendingDelays(),
      this.flushOutbox(),
      this.flushRealtimeOutbox(),
    ]);
    await this.reconcileRuntime(command.event, command);
    this.compactRuntimeStorage();
    return snapshot;
  }

  async resumeDelay(payload: FlowDelayPayload): Promise<FlowRuntimeSnapshot | null> {
    const delay = firstRow<{
      status: string;
      workflow_id: string;
      workflow_version_id: string;
      block_id: string;
      target_block_id: string;
    }>(
      this.ctx.storage.sql.exec(
        `SELECT status, workflow_id, workflow_version_id, block_id,
          target_block_id FROM runtime_delays WHERE id = ?`,
        payload.id,
      ),
    );
    if (!delay || delay.status !== "scheduled") {
      await Promise.all([this.flushOutbox(), this.flushRealtimeOutbox()]);
      this.compactRuntimeStorage();
      return null;
    }
    const current = this.readState(delay.workflow_id);
    if (
      !current ||
      current.workflow_version_id !== delay.workflow_version_id ||
      !parseStringArray(current.active_block_ids_json).includes(delay.block_id)
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE runtime_delays SET status = 'cancelled', resumed_at = ? WHERE id = ?",
        new Date().toISOString(),
        payload.id,
      );
      return null;
    }
    const active = parseStringArray(current.active_block_ids_json).filter(
      (id) => id !== delay.block_id,
    );
    active.push(delay.target_block_id);
    const now = new Date().toISOString();
    const graph = JSON.parse(current.graph_json) as FlowRuntimeCommand["graph"];
    const stateIds = parseStringMap(current.block_state_ids_json);
    const resumed = executeGraph({
      graph,
      userProperties: {
        ...parseUnknownRecord(current.user_properties_json),
        __flow_user_id: payload.userIdHash,
      },
      activeBlockIds: [...new Set(active)],
      event: { name: "enter", blockId: delay.target_block_id },
      workflowId: delay.workflow_id,
      blockStateId: (blockId) => {
        const existing = stateIds[blockId];
        if (existing) return existing;
        const created = `${delay.workflow_id}:${current.generation}:${blockId}:${crypto.randomUUID()}`;
        stateIds[blockId] = created;
        return created;
      },
      tourIndexes: this.readTourIndexes(delay.workflow_id),
    });
    const resumedState = resumed.completed
      ? "completed"
      : resumed.activeBlockIds.length
        ? "in-progress"
        : "not-started";
    const exitedAt = resumed.completed ? now : null;
    const revision = Number(current.revision ?? 0) + 1;
    const outbox: FlowQueueEvent = {
      schemaVersion: 1,
      eventId: `${payload.eventId}:resume:${payload.blockId}`,
      projectId: payload.projectId,
      projectRef: payload.projectRef,
      environmentId: payload.environmentId,
      userIdHash: payload.userIdHash,
      name: "transition",
      occurredAt: now,
      workflowId: delay.workflow_id,
      workflowVersionId: delay.workflow_version_id,
      blockId: delay.block_id,
      properties: {
        delayed: true,
        targetBlockId: delay.target_block_id,
        __runtime_state: {
          state: resumedState,
          activeBlockIds: resumed.activeBlockIds,
          enteredAt: current.entered_at,
          exitedAt,
          generation: current.generation,
          revision,
          tourIndexes: this.readTourIndexes(delay.workflow_id),
        },
      },
    };
    const chainedDelays = resumed.delays.map((nextDelay) => {
      const chainedPayload: FlowDelayPayload = {
        ...payload,
        id: `${outbox.eventId}:delay:${nextDelay.blockId}`,
        eventId: outbox.eventId,
        delayMs: nextDelay.delayMs,
        workflowId: delay.workflow_id,
        workflowVersionId: delay.workflow_version_id,
        blockId: nextDelay.blockId,
        targetBlockId: nextDelay.targetBlockId,
      };
      return { delay: nextDelay, payload: chainedPayload };
    });
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE runtime_workflows SET active_block_ids_json = ?,
          block_state_ids_json = ?, state = ?, exited_at = ?, revision = ?,
          updated_at = ?
         WHERE workflow_id = ?`,
        JSON.stringify(resumed.activeBlockIds),
        JSON.stringify(stateIds),
        resumedState,
        exitedAt,
        revision,
        now,
        delay.workflow_id,
      );
      this.ctx.storage.sql.exec(
        "UPDATE runtime_delays SET status = 'resumed', resumed_at = ? WHERE id = ?",
        now,
        payload.id,
      );
      this.insertOutbox(outbox);
      this.insertRealtimeOutbox(outbox, {
        exitedBlockIds: [delay.block_id, ...resumed.exitedBlockIds],
        updatedBlocks: resumed.updatedBlocks,
      });
      for (const { delay: nextDelay, payload: chainedPayload } of chainedDelays) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO runtime_delays
            (id, workflow_id, workflow_version_id, block_id, target_block_id,
             payload_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
          chainedPayload.id,
          delay.workflow_id,
          delay.workflow_version_id,
          nextDelay.blockId,
          nextDelay.targetBlockId,
          JSON.stringify(chainedPayload),
          now,
        );
      }
    });
    await Promise.all([
      this.startPendingDelays(),
      this.flushOutbox(),
      this.flushRealtimeOutbox(),
    ]);
    await this.reconcileRuntime(outbox, {});
    this.compactRuntimeStorage();
    const snapshot = this.snapshotFromState(
      this.readState(delay.workflow_id)!,
      [],
      false,
    );
    return snapshot;
  }

  private async endForMigration(
    command: FlowRuntimeCommand,
    previous: StateRow,
    commandHash: string,
  ): Promise<FlowRuntimeSnapshot> {
    const workflowId = previous.workflow_id;
    const now = new Date().toISOString();
    const exitedBlockIds = parseStringArray(previous.active_block_ids_json);
    const snapshot: FlowRuntimeSnapshot = {
      workflowId,
      ...(previous.workflow_version_id
        ? { workflowVersionId: previous.workflow_version_id }
        : {}),
      state: "stopped",
      activeBlockIds: [],
      exitedBlockIds,
      updatedBlocks: [],
      ...(previous.entered_at ? { enteredAt: previous.entered_at } : {}),
      exitedAt: now,
      duplicate: false,
    };
    const event: FlowQueueEvent = {
      ...command.event,
      name: "workflow-exit",
      ...(previous.workflow_version_id
        ? { workflowVersionId: previous.workflow_version_id }
        : {}),
      occurredAt: now,
      properties: {
        migration_strategy: command.migrationStrategy,
        requested_version_id: command.event.workflowVersionId ?? "draft",
        __runtime_state: {
          state: "stopped",
          activeBlockIds: [],
          enteredAt: previous.entered_at,
          exitedAt: now,
          generation: previous.generation,
          revision: previous.revision + 1,
          tourIndexes: this.readTourIndexes(workflowId),
        },
      },
    };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE runtime_workflows SET state = 'stopped',
          active_block_ids_json = '[]', exited_at = ?, revision = ?, updated_at = ?
         WHERE workflow_id = ?`,
        now,
        previous.revision + 1,
        now,
        workflowId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE runtime_delays SET status = 'cancelled', resumed_at = ?
         WHERE workflow_id = ? AND status = 'scheduled'`,
        now,
        workflowId,
      );
      this.insertOutbox(event);
      this.insertRealtimeOutbox(event, { exitedBlockIds, updatedBlocks: [] });
      this.persistIdempotency(command.event.eventId, workflowId, commandHash, snapshot);
    });
    await Promise.all([
      this.flushOutbox(),
      this.flushRealtimeOutbox(),
    ]);
    this.compactRuntimeStorage();
    return snapshot;
  }

  async getSnapshot(workflowId: string): Promise<FlowRuntimeSnapshot | null> {
    const row = this.readState(workflowId);
    return row ? this.snapshotFromState(row, [], false) : null;
  }

  async bootstrapProjection(
    command: FlowRuntimeBootstrapCommand,
  ): Promise<FlowRuntimeSnapshot> {
    const existing = this.readState(command.workflowId);
    if (existing) return this.snapshotFromState(existing, [], false);
    const graphBlockIds = new Set(command.graph.blocks.map((block) => block.id));
    const activeBlockIds = [...new Set(command.activeBlockIds)].filter((id) =>
      graphBlockIds.has(id)
    );
    const blockStateIds = Object.fromEntries(
      activeBlockIds.map((blockId) => [
        blockId,
        `${command.workflowId}:${command.generation}:${blockId}:${crypto.randomUUID()}`,
      ]),
    );
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO runtime_workflows
        (workflow_id, workflow_version_id, state, active_block_ids_json,
         block_state_ids_json, graph_json, user_properties_json, entered_at,
         exited_at, generation, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      command.workflowId,
      command.workflowVersionId,
      command.state,
      JSON.stringify(activeBlockIds),
      JSON.stringify(blockStateIds),
      JSON.stringify(command.graph),
      JSON.stringify(command.userProperties),
      command.enteredAt ?? null,
      command.exitedAt ?? null,
      Math.max(1, command.generation),
      Math.max(0, command.revision),
      command.updatedAt,
    );
    for (const [blockId, currentIndex] of Object.entries(command.tourIndexes ?? {})) {
      if (!graphBlockIds.has(blockId) || !Number.isSafeInteger(currentIndex) || currentIndex < 0) {
        continue;
      }
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO runtime_tours
          (workflow_id, block_id, current_index, updated_at)
         VALUES (?, ?, ?, ?)`,
        command.workflowId,
        blockId,
        currentIndex,
        command.updatedAt,
      );
    }
    return this.snapshotFromState(this.readState(command.workflowId)!, [], false);
  }

  async resetProgress(
    command: FlowRuntimeResetCommand,
  ): Promise<{ reset: number; duplicate?: boolean }> {
    const selected = new Set(command.workflowIds ?? []);
    const scopeJson = JSON.stringify([...selected].sort());
    const receipt = firstRow<{ scope_json: string; response_json: string }>(
      this.ctx.storage.sql.exec(
        `SELECT scope_json, response_json FROM runtime_reset_idempotency
         WHERE event_id = ?`,
        command.eventId,
      ),
    );
    if (receipt) {
      if (receipt.scope_json !== scopeJson) {
        throw new Error("flow_runtime_idempotency_conflict");
      }
      return {
        ...(JSON.parse(receipt.response_json) as { reset: number }),
        duplicate: true,
      };
    }
    const rows = [...this.ctx.storage.sql.exec<StateRow>("SELECT * FROM runtime_workflows")]
      .filter((row) => selected.size === 0 || selected.has(row.workflow_id));
    const now = new Date().toISOString();
    const events: FlowQueueEvent[] = [];
    const messages: Array<{ event: FlowQueueEvent; message: FlowWebSocketMessage }> = [];
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        const event: FlowQueueEvent = {
          schemaVersion: 1,
          eventId: `${command.eventId}:${command.environmentId}:${row.workflow_id}`,
          projectId: command.projectId,
          projectRef: command.projectRef,
          environmentId: command.environmentId,
          userIdHash: command.userIdHash,
          name: "reset-progress",
          occurredAt: now,
          workflowId: row.workflow_id,
          ...(row.workflow_version_id
            ? { workflowVersionId: row.workflow_version_id }
            : {}),
          properties: {
            source: "admin",
            __runtime_state: {
              state: "not-started",
              activeBlockIds: [],
              enteredAt: null,
              exitedAt: null,
              generation: row.generation + 1,
              revision: 1,
              tourIndexes: {},
            },
          },
        };
        events.push(event);
        messages.push({
          event,
          message: {
            exitedBlockIds: parseStringArray(row.active_block_ids_json),
            updatedBlocks: [],
          },
        });
        // Keep a tombstone row so the monotone generation cannot return to 1
        // after a reset. The next identify continues generation+revision and
        // therefore remains newer than the reset projection in D1.
        this.ctx.storage.sql.exec(
          `UPDATE runtime_workflows SET state = 'not-started',
            active_block_ids_json = '[]', block_state_ids_json = '{}',
            entered_at = NULL, exited_at = NULL, generation = ?, revision = 1,
            updated_at = ? WHERE workflow_id = ?`,
          row.generation + 1,
          now,
          row.workflow_id,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM runtime_state_memory WHERE workflow_id = ?",
          row.workflow_id,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM runtime_tours WHERE workflow_id = ?",
          row.workflow_id,
        );
        this.ctx.storage.sql.exec(
          `UPDATE runtime_delays SET status = 'cancelled', resumed_at = ?
           WHERE workflow_id = ? AND status = 'scheduled'`,
          now,
          row.workflow_id,
        );
        this.insertOutbox(event);
        this.insertRealtimeOutbox(event, messages.at(-1)!.message);
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO runtime_reset_idempotency
          (event_id, scope_json, response_json, created_at)
         VALUES (?, ?, ?, ?)`,
        command.eventId,
        scopeJson,
        JSON.stringify({ reset: events.length }),
        now,
      );
    });
    await Promise.all([
      this.flushOutbox(),
      this.flushRealtimeOutbox(),
    ]);
    this.compactRuntimeStorage();
    return { reset: events.length };
  }

  async alarm(): Promise<void> {
    this.reconcileExpiredDelayExecutions();
    await Promise.all([
      this.startPendingDelays(),
      this.flushOutbox(),
      this.flushRealtimeOutbox(),
    ]);
    await this.scheduleNextDelayRecovery();
    this.compactRuntimeStorage();
  }

  /**
   * Continue server-side orchestration after an asynchronous transition. This
   * deliberately lives in the per-user authority rather than in an HTTP
   * handler: a sleeping Workflow can wake a trigger parent and can release a
   * Launchpad slot even when the client only has a WebSocket open.
   */
  private async reconcileRuntime(
    seed: FlowQueueEvent,
    options: Pick<FlowRuntimeCommand, "resolveTriggers" | "reconcileLaunchpad">,
  ): Promise<void> {
    if (options.resolveTriggers !== false) {
      await this.resolveRuntimeWorkflowTriggers(seed);
    }
    if (options.reconcileLaunchpad !== false) {
      await this.reconcileRuntimeLaunchpad(seed);
    }
    // A workflow started from the newly available Launchpad slot may itself
    // begin with a Workflow Trigger.
    if (options.resolveTriggers !== false) {
      await this.resolveRuntimeWorkflowTriggers(seed);
    }
  }

  private async resolveRuntimeWorkflowTriggers(seed: FlowQueueEvent): Promise<void> {
    for (let iteration = 0; iteration < 16; iteration += 1) {
      let progressed = false;
      const parents = [...this.ctx.storage.sql.exec<StateRow>(
        `SELECT * FROM runtime_workflows WHERE state = 'in-progress'
         ORDER BY workflow_id`,
      )];
      for (const parent of parents) {
        const graph = JSON.parse(parent.graph_json) as FlowRuntimeCommand["graph"];
        const active = new Set(parseStringArray(parent.active_block_ids_json));
        for (const block of graph.blocks) {
          if (block.type !== "workflow-trigger" || !active.has(block.id)) continue;
          const targetWorkflowId = typeof block.data.workflowId === "string"
            ? block.data.workflowId
            : "";
          const blockKey = typeof block.data.blockKey === "string"
            ? block.data.blockKey
            : "";
          if (!targetWorkflowId || !blockKey) continue;

          let targetState = this.readState(targetWorkflowId);
          const release = await this.loadActiveRuntimeRelease(
            seed.projectId,
            seed.environmentId,
            targetWorkflowId,
          );
          const mustStartTarget = !targetState ||
            targetState.state === "not-started" ||
            (
              release?.frequency === "every-time" &&
              (targetState.state === "completed" || targetState.state === "stopped")
            );
          if (mustStartTarget) {
            if (!release || !release.graph.blocks.some(
              (candidate) => candidate.type === "manual-start" && candidate.key === blockKey,
            )) {
              console.error(JSON.stringify({
                event: "flow_runtime_trigger_target_unavailable",
                workflow_id: parent.workflow_id,
                block_id: block.id,
                target_workflow_id: targetWorkflowId,
                block_key: blockKey,
              }));
              continue;
            }
            await this.execute({
              event: {
                ...seed,
                eventId: await flowWorkflowInstanceId(
                  "flow-trigger-start",
                  `${seed.eventId}:${parent.workflow_id}:${block.id}:${targetWorkflowId}:${blockKey}`,
                ),
                name: "workflow-start",
                occurredAt: new Date().toISOString(),
                workflowId: targetWorkflowId,
                workflowVersionId: release.workflowVersionId,
                blockId: undefined,
                blockStateId: undefined,
                blockKey,
                propertyKey: undefined,
                properties: undefined,
              },
              graph: release.graph,
              frequency: release.frequency,
              migrationStrategy: release.migrationStrategy,
              userProperties: this.readLatestUserProperties(),
              resolveTriggers: false,
              reconcileLaunchpad: false,
            });
            targetState = this.readState(targetWorkflowId);
            progressed = true;
          }

          if (targetState?.state === "completed" || targetState?.state === "stopped") {
            await this.execute({
              event: {
                ...seed,
                eventId: await flowWorkflowInstanceId(
                  "flow-trigger-exit",
                  `${seed.eventId}:${parent.workflow_id}:${block.id}:${targetWorkflowId}:${targetState.generation}:${targetState.revision}`,
                ),
                name: "transition",
                occurredAt: new Date().toISOString(),
                workflowId: parent.workflow_id,
                ...(parent.workflow_version_id
                  ? { workflowVersionId: parent.workflow_version_id }
                  : {}),
                blockId: block.id,
                blockStateId: undefined,
                blockKey: undefined,
                propertyKey: "workflow_completed",
                properties: undefined,
              },
              graph,
              frequency: "every-time",
              migrationStrategy: "finish-current",
              userProperties: parseUnknownRecord(parent.user_properties_json),
              resolveTriggers: false,
              reconcileLaunchpad: false,
            });
            progressed = true;
          }
        }
      }
      if (!progressed) return;
    }
    console.error(JSON.stringify({
      event: "flow_runtime_trigger_iteration_limit",
      seed_event_id: seed.eventId,
    }));
  }

  private async reconcileRuntimeLaunchpad(seed: FlowQueueEvent): Promise<void> {
    const rows = await this.env.DB.prepare(
      `SELECT w.id AS workflow_id, w.frequency,
        CASE WHEN r.use_draft = 1
          THEN 'draft:' || CAST(d.revision AS TEXT) ELSE v.id END AS workflow_version_id,
        CASE WHEN r.use_draft = 1 THEN d.graph_json ELSE v.graph_json END AS graph_json,
        CASE WHEN r.use_draft = 1 THEN 'finish-current'
          ELSE COALESCE(v.migration_strategy, 'finish-current') END AS migration_strategy,
        g.id AS group_id, g.position, g.paused, g.concurrency_limit, lw.priority
       FROM flow_environment_releases r
       JOIN flow_workflows w
         ON w.project_id = r.project_id AND w.id = r.workflow_id
       JOIN flow_launchpad_workflows lw ON lw.workflow_id = w.id
       JOIN flow_launchpad_groups g
         ON g.project_id = r.project_id AND g.environment_id = r.environment_id
        AND g.id = lw.group_id
       LEFT JOIN flow_workflow_drafts d ON d.workflow_id = r.workflow_id
       LEFT JOIN flow_workflow_versions v
         ON v.project_id = r.project_id AND v.id = r.workflow_version_id
       WHERE r.project_id = ? AND r.environment_id = ? AND r.active = 1
         AND w.status = 'active'
         AND ((r.use_draft = 1 AND d.graph_json IS NOT NULL)
           OR (r.use_draft = 0 AND v.graph_json IS NOT NULL))
       ORDER BY g.position, lw.priority DESC, g.id, w.id`,
    ).bind(seed.projectId, seed.environmentId).all<{
      workflow_id: string;
      workflow_version_id: string;
      frequency: "once" | "every-time";
      graph_json: string;
      migration_strategy: FlowRuntimeCommand["migrationStrategy"];
      group_id: string;
      position: number;
      paused: number;
      concurrency_limit: number | null;
      priority: number;
    }>();
    if (!rows.results.length) return;

    const assignmentRows = await this.env.DB.prepare(
      `SELECT workflow_id, group_id FROM flow_launchpad_assignments
       WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?`,
    ).bind(seed.projectId, seed.environmentId, seed.userIdHash).all<{
      workflow_id: string;
      group_id: string;
    }>();
    const assigned = new Map(
      assignmentRows.results.map((row) => [row.workflow_id, row.group_id]),
    );
    const memberships = new Map<string, Set<string>>();
    for (const row of rows.results) {
      const values = memberships.get(row.workflow_id) ?? new Set<string>();
      values.add(row.group_id);
      memberships.set(row.workflow_id, values);
    }
    for (const [workflowId, groupId] of assigned) {
      if (!memberships.get(workflowId)?.has(groupId)) assigned.delete(workflowId);
    }

    const properties = this.readLatestUserProperties();
    const selected = new Set<string>();
    const groups = new Map<string, typeof rows.results>();
    for (const row of rows.results) {
      const values = groups.get(row.group_id) ?? [];
      values.push(row);
      groups.set(row.group_id, values);
    }
    for (const candidates of groups.values()) {
      const group = candidates[0]!;
      const running = candidates.filter((candidate) => {
        const state = this.readState(candidate.workflow_id);
        if (state?.state !== "in-progress") return false;
        const groupId = assigned.get(candidate.workflow_id) ??
          rows.results.find(
            (membership) =>
              membership.workflow_id === candidate.workflow_id && !membership.paused,
          )?.group_id;
        if (groupId === group.group_id) selected.add(candidate.workflow_id);
        return groupId === group.group_id;
      });
      if (group.paused) continue;
      let capacity = group.concurrency_limit == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(group.concurrency_limit) - running.length);
      for (const candidate of candidates) {
        if (capacity <= 0 || selected.has(candidate.workflow_id)) continue;
        const state = this.readState(candidate.workflow_id);
        if (state?.state === "in-progress") continue;
        if (
          candidate.frequency === "once" &&
          (state?.state === "completed" || state?.state === "stopped")
        ) {
          selected.add(candidate.workflow_id);
          continue;
        }
        let graph = JSON.parse(candidate.graph_json) as FlowRuntimeCommand["graph"];
        if (!graph.blocks.some(
          (block) => block.type === "start" && matchesTargeting(block.conditions, properties),
        )) continue;
        graph = await this.graphWithPersistedAssignments(
          seed.projectId,
          seed.environmentId,
          seed.userIdHash,
          candidate.workflow_id,
          graph,
        );
        const snapshot = await this.execute({
          event: {
            ...seed,
            eventId: await flowWorkflowInstanceId(
              "flow-launchpad-start",
              `${seed.eventId}:${group.group_id}:${candidate.workflow_id}`,
            ),
            name: "identify",
            occurredAt: new Date().toISOString(),
            workflowId: candidate.workflow_id,
            workflowVersionId: candidate.workflow_version_id,
            blockId: undefined,
            blockStateId: undefined,
            blockKey: undefined,
            propertyKey: undefined,
            properties: undefined,
          },
          graph,
          frequency: candidate.frequency,
          migrationStrategy: candidate.migration_strategy,
          userProperties: properties,
          resolveTriggers: false,
          reconcileLaunchpad: false,
        });
        selected.add(candidate.workflow_id);
        if (snapshot.state === "in-progress") {
          assigned.set(candidate.workflow_id, group.group_id);
          await this.env.DB.prepare(
            `INSERT INTO flow_launchpad_assignments
              (project_id, environment_id, user_id_hash, workflow_id, group_id, assigned_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, environment_id, user_id_hash, workflow_id)
             DO UPDATE SET group_id = excluded.group_id, assigned_at = excluded.assigned_at`,
          ).bind(
            seed.projectId,
            seed.environmentId,
            seed.userIdHash,
            candidate.workflow_id,
            group.group_id,
            new Date().toISOString(),
          ).run();
          capacity -= 1;
        }
      }
    }
  }

  private async loadActiveRuntimeRelease(
    projectId: number,
    environmentId: string,
    workflowId: string,
  ): Promise<{
    workflowVersionId: string;
    frequency: FlowRuntimeCommand["frequency"];
    migrationStrategy: FlowRuntimeCommand["migrationStrategy"];
    graph: FlowRuntimeCommand["graph"];
  } | null> {
    const row = await this.env.DB.prepare(
      `SELECT w.frequency,
        CASE WHEN r.use_draft = 1
          THEN 'draft:' || CAST(d.revision AS TEXT) ELSE v.id END AS workflow_version_id,
        CASE WHEN r.use_draft = 1 THEN d.graph_json ELSE v.graph_json END AS graph_json,
        CASE WHEN r.use_draft = 1 THEN 'finish-current'
          ELSE COALESCE(v.migration_strategy, 'finish-current') END AS migration_strategy
       FROM flow_environment_releases r
       JOIN flow_workflows w
         ON w.project_id = r.project_id AND w.id = r.workflow_id
       LEFT JOIN flow_workflow_drafts d ON d.workflow_id = r.workflow_id
       LEFT JOIN flow_workflow_versions v
         ON v.project_id = r.project_id AND v.id = r.workflow_version_id
       WHERE r.project_id = ? AND r.environment_id = ? AND r.workflow_id = ?
         AND r.active = 1 AND w.status = 'active'
         AND ((r.use_draft = 1 AND d.graph_json IS NOT NULL)
           OR (r.use_draft = 0 AND v.graph_json IS NOT NULL))
       LIMIT 1`,
    ).bind(projectId, environmentId, workflowId).first<{
      workflow_version_id: string;
      frequency: FlowRuntimeCommand["frequency"];
      graph_json: string;
      migration_strategy: FlowRuntimeCommand["migrationStrategy"];
    }>();
    return row
      ? {
          workflowVersionId: row.workflow_version_id,
          frequency: row.frequency,
          migrationStrategy: row.migration_strategy,
          graph: JSON.parse(row.graph_json) as FlowRuntimeCommand["graph"],
        }
      : null;
  }

  private async graphWithPersistedAssignments(
    projectId: number,
    environmentId: string,
    userIdHash: string,
    workflowId: string,
    graph: FlowRuntimeCommand["graph"],
  ): Promise<FlowRuntimeCommand["graph"]> {
    const rows = await this.env.DB.prepare(
      `SELECT split_block_id, variant_key FROM flow_experiment_assignments
       WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?
         AND workflow_id = ?`,
    ).bind(projectId, environmentId, userIdHash, workflowId).all<{
      split_block_id: string;
      variant_key: string;
    }>();
    const byBlock = new Map(
      rows.results.map((row) => [row.split_block_id, row.variant_key]),
    );
    return {
      ...graph,
      blocks: graph.blocks.map((block) => {
        const assignedVariantKey = byBlock.get(block.id);
        return block.type === "traffic-split" && assignedVariantKey
          ? { ...block, data: { ...block.data, assignedVariantKey } }
          : block;
      }),
    };
  }

  private migrateRuntimeSchema(): void {
    const delayColumns = new Set(
      [...this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(runtime_delays)")]
        .map((column) => column.name),
    );
    if (!delayColumns.has("payload_json")) {
      this.ctx.storage.sql.exec("ALTER TABLE runtime_delays ADD COLUMN payload_json TEXT");
    }
    if (!delayColumns.has("start_attempt_count")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runtime_delays ADD COLUMN start_attempt_count INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!delayColumns.has("execution_started_at")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runtime_delays ADD COLUMN execution_started_at TEXT",
      );
    }
    if (!delayColumns.has("recovery_at")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runtime_delays ADD COLUMN recovery_at TEXT",
      );
    }
    const workflowColumns = new Set(
      [...this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(runtime_workflows)")]
        .map((column) => column.name),
    );
    if (!workflowColumns.has("revision")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runtime_workflows ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
    }
    const idempotencyColumns = new Set(
      [...this.ctx.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(runtime_idempotency)",
      )].map((column) => column.name),
    );
    if (!idempotencyColumns.has("command_hash")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE runtime_idempotency ADD COLUMN command_hash TEXT NOT NULL DEFAULT ''",
      );
    }
  }

  private readState(workflowId: string): StateRow | null {
    return firstRow<StateRow>(
      this.ctx.storage.sql.exec(
        "SELECT * FROM runtime_workflows WHERE workflow_id = ?",
        workflowId,
      ),
    );
  }

  private assertTargetState(
    command: FlowRuntimeCommand,
    previous: StateRow | null,
  ): void {
    const targetName = command.event.name;
    if (!new Set([
      "transition",
      "tour-update",
      "block-activated",
      "survey-submit",
      "set-state-memory",
    ]).has(targetName)) return;
    const graph = previous
      ? (JSON.parse(previous.graph_json) as FlowRuntimeCommand["graph"])
      : command.graph;
    const target = command.event.blockId
      ? graph.blocks.find((block) => block.id === command.event.blockId)
      : command.event.blockKey
        ? graph.blocks.find((block) => block.key === command.event.blockKey)
        : undefined;
    if (!previous || !target || !parseStringArray(previous.active_block_ids_json).includes(target.id)) {
      throw new Error("flow_runtime_block_not_active");
    }
    if (targetName === "survey-submit" && target.type !== "survey") {
      throw new Error("flow_runtime_survey_not_active");
    }
    if (command.event.blockStateId) {
      const stateIds = parseStringMap(previous.block_state_ids_json);
      if (stateIds[target.id] !== command.event.blockStateId) {
        throw new Error("flow_runtime_block_state_stale");
      }
    } else if (targetName === "survey-submit") {
      throw new Error("flow_runtime_block_state_required");
    }
  }

  private graphWithStateMemory(
    workflowId: string,
    graph: FlowRuntimeCommand["graph"],
  ): FlowRuntimeCommand["graph"] {
    const remembered = Object.fromEntries(
      [...this.ctx.storage.sql.exec<{ property_key: string; value_json: string }>(
        `SELECT property_key, value_json FROM runtime_state_memory
         WHERE workflow_id = ?`,
        workflowId,
      )].map((row) => [row.property_key, parseUnknown(row.value_json)]),
    );
    if (!Object.keys(remembered).length) return graph;
    return {
      ...graph,
      blocks: graph.blocks.map((block) => ({
        ...block,
        propertyMeta: block.propertyMeta.map((property) =>
          property.type === "state-memory" && Object.hasOwn(remembered, property.key)
            ? { ...property, value: remembered[property.key] }
            : property,
        ),
      })),
    };
  }

  private readTourIndexes(workflowId: string): Record<string, number> {
    return Object.fromEntries(
      [...this.ctx.storage.sql.exec<{ block_id: string; current_index: number }>(
        `SELECT block_id, current_index FROM runtime_tours
         WHERE workflow_id = ?`,
        workflowId,
      )].map((row) => [row.block_id, Number(row.current_index)]),
    );
  }

  private readLatestUserProperties(): Record<string, unknown> {
    const row = firstRow<{ user_properties_json: string }>(
      this.ctx.storage.sql.exec(
        `SELECT user_properties_json FROM runtime_workflows
         ORDER BY updated_at DESC LIMIT 1`,
      ),
    );
    return row ? parseUnknownRecord(row.user_properties_json) : {};
  }

  private readDuplicate(
    eventId: string,
    workflowId: string,
    commandHash: string,
  ): FlowRuntimeSnapshot | null {
    const row = firstRow<{ command_hash: string; response_json: string }>(
      this.ctx.storage.sql.exec(
        `SELECT command_hash, response_json FROM runtime_idempotency
         WHERE event_id = ? AND workflow_id = ?`,
        eventId,
        workflowId,
      ),
    );
    if (row && row.command_hash !== commandHash) {
      throw new Error("flow_runtime_idempotency_conflict");
    }
    return row ? (JSON.parse(row.response_json) as FlowRuntimeSnapshot) : null;
  }

  private persistIdempotency(
    eventId: string,
    workflowId: string,
    commandHash: string,
    snapshot: FlowRuntimeSnapshot,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO runtime_idempotency
        (event_id, workflow_id, command_hash, response_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      eventId,
      workflowId,
      commandHash,
      JSON.stringify(snapshot),
      new Date().toISOString(),
    );
  }

  private insertOutbox(event: FlowQueueEvent): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO runtime_outbox
        (event_id, payload_json, status, attempt_count, created_at)
       VALUES (?, ?, 'pending', 0, ?)`,
      event.eventId,
      JSON.stringify(event),
      new Date().toISOString(),
    );
  }

  private insertRealtimeOutbox(
    event: FlowQueueEvent,
    message: FlowWebSocketMessage,
  ): void {
    if (!message.exitedBlockIds.length && !message.updatedBlocks.length) return;
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO runtime_realtime_outbox
        (event_id, project_id, environment_id, user_id_hash, message_json,
         status, attempt_count, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
      event.eventId,
      event.projectId,
      event.environmentId,
      event.userIdHash,
      JSON.stringify(message),
      new Date().toISOString(),
    );
  }

  private delayExists(eventId: string, blockId: string): boolean {
    return Boolean(
      firstRow<{ id: string }>(
        this.ctx.storage.sql.exec(
          "SELECT id FROM runtime_delays WHERE id = ?",
          `${eventId}:delay:${blockId}`,
        ),
      ),
    );
  }

  private delayPayload(
    command: FlowRuntimeCommand,
    delay: { blockId: string; targetBlockId: string; delayMs: number },
  ): FlowDelayPayload {
    return {
      id: `${command.event.eventId}:delay:${delay.blockId}`,
      runtimeName: [
        command.event.projectId,
        command.event.environmentId,
        command.event.userIdHash,
      ].join(":"),
      eventId: command.event.eventId,
      delayMs: delay.delayMs,
      workflowId: command.event.workflowId!,
      workflowVersionId: command.event.workflowVersionId ?? "draft",
      blockId: delay.blockId,
      targetBlockId: delay.targetBlockId,
      projectId: command.event.projectId,
      projectRef: command.event.projectRef,
      environmentId: command.event.environmentId,
      userIdHash: command.event.userIdHash,
    };
  }

  private async startPendingDelays(): Promise<void> {
    const rows = [
      ...this.ctx.storage.sql.exec<DelayStartRow>(
        `SELECT id, payload_json, start_attempt_count FROM runtime_delays
         WHERE status = 'scheduled' AND execution_started_at IS NULL
           AND payload_json IS NOT NULL
         ORDER BY created_at LIMIT 100`,
      ),
    ];
    let failed = false;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as FlowDelayPayload;
      try {
        await this.env.FLOW_DELAY_EXECUTION.create({
          id: await flowWorkflowInstanceId(
            "flow-delay",
            `${row.id}:attempt:${row.start_attempt_count + 1}`,
          ),
          params: payload,
        });
      } catch (error) {
        if (!/already exists|instance.*exists/iu.test(errorMessage(error))) {
          failed = true;
          this.ctx.storage.sql.exec(
            `UPDATE runtime_delays SET start_attempt_count = start_attempt_count + 1
             WHERE id = ? AND execution_started_at IS NULL`,
            row.id,
          );
          console.error(JSON.stringify({
            event: "flow_delay_start_failed",
            delay_id: row.id,
            attempt: row.start_attempt_count + 1,
            error: errorMessage(error),
          }));
          continue;
        }
      }
      const startedAt = new Date();
      // A terminal Workflow failure has no automatic callback. Keep a lease in
      // the authority DO and start a fresh deterministic Workflow attempt when
      // the expected sleep plus retry budget has elapsed.
      const recoveryAt = new Date(
        startedAt.getTime() + payload.delayMs + 2 * 60 * 60 * 1_000,
      );
      this.ctx.storage.sql.exec(
        `UPDATE runtime_delays SET execution_started_at = ?, recovery_at = ?,
          start_attempt_count = start_attempt_count + 1 WHERE id = ?`,
        startedAt.toISOString(),
        recoveryAt.toISOString(),
        row.id,
      );
      await this.scheduleAlarmAt(recoveryAt.getTime());
    }
    const remains = Boolean(firstRow(
      this.ctx.storage.sql.exec<{ pending: number }>(
        `SELECT 1 AS pending FROM runtime_delays
         WHERE status = 'scheduled' AND execution_started_at IS NULL
           AND payload_json IS NOT NULL LIMIT 1`,
      ),
    ));
    if (failed || remains) await this.scheduleRetryAlarm();
    await this.scheduleNextDelayRecovery();
  }

  private async flushOutbox(): Promise<void> {
    const rows = [
      ...this.ctx.storage.sql.exec<OutboxRow>(
        `SELECT event_id, payload_json, attempt_count FROM runtime_outbox
         WHERE status = 'pending' ORDER BY created_at LIMIT 100`,
      ),
    ];
    let failed = false;
    for (const row of rows) {
      try {
        await this.env.FLOW_EVENTS.send(
          JSON.parse(row.payload_json) as FlowQueueEvent,
          { contentType: "json" },
        );
        this.ctx.storage.sql.exec(
          `UPDATE runtime_outbox SET status = 'delivered', delivered_at = ?,
            attempt_count = attempt_count + 1 WHERE event_id = ?`,
          new Date().toISOString(),
          row.event_id,
        );
      } catch (error) {
        failed = true;
        this.ctx.storage.sql.exec(
          `UPDATE runtime_outbox SET attempt_count = attempt_count + 1
           WHERE event_id = ?`,
          row.event_id,
        );
        console.error(JSON.stringify({
          event: "flow_outbox_delivery_failed",
          event_id: row.event_id,
          attempt: row.attempt_count + 1,
          error: errorMessage(error),
        }));
      }
    }
    const remains = Boolean(firstRow(
      this.ctx.storage.sql.exec<{ pending: number }>(
        `SELECT 1 AS pending FROM runtime_outbox
         WHERE status = 'pending' LIMIT 1`,
      ),
    ));
    if (failed || remains) await this.scheduleRetryAlarm();
  }

  private async flushRealtimeOutbox(): Promise<void> {
    const rows = [
      ...this.ctx.storage.sql.exec<RealtimeOutboxRow>(
        `SELECT event_id, project_id, environment_id, user_id_hash,
          message_json, attempt_count
         FROM runtime_realtime_outbox
         WHERE status = 'pending' ORDER BY rowid LIMIT 100`,
      ),
    ];
    let failed = false;
    for (const row of rows) {
      try {
        const name = flowHubName(
          Number(row.project_id),
          row.environment_id,
          row.user_id_hash,
        );
        await this.env.FLOW_REALTIME_HUB.getByName(name).broadcast(
          row.user_id_hash,
          JSON.parse(row.message_json) as FlowWebSocketMessage,
        );
        this.ctx.storage.sql.exec(
          `UPDATE runtime_realtime_outbox SET status = 'delivered',
            delivered_at = ?, attempt_count = attempt_count + 1
           WHERE event_id = ?`,
          new Date().toISOString(),
          row.event_id,
        );
      } catch (error) {
        failed = true;
        this.ctx.storage.sql.exec(
          `UPDATE runtime_realtime_outbox SET attempt_count = attempt_count + 1
           WHERE event_id = ?`,
          row.event_id,
        );
        console.error(JSON.stringify({
          event: "flow_realtime_delivery_failed",
          event_id: row.event_id,
          attempt: row.attempt_count + 1,
          error: errorMessage(error),
        }));
        // The public WebSocket message intentionally has no sequence field, so
        // never deliver a newer update before an older pending update.
        break;
      }
    }
    const remains = Boolean(firstRow(
      this.ctx.storage.sql.exec<{ pending: number }>(
        `SELECT 1 AS pending FROM runtime_realtime_outbox
         WHERE status = 'pending' LIMIT 1`,
      ),
    ));
    if (failed || remains) await this.scheduleRetryAlarm();
  }

  private async scheduleRetryAlarm(): Promise<void> {
    await this.scheduleAlarmAt(Date.now() + 30_000);
  }

  private async scheduleAlarmAt(timestamp: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current == null || timestamp < current) {
      await this.ctx.storage.setAlarm(timestamp);
    }
  }

  private async scheduleNextDelayRecovery(): Promise<void> {
    const next = firstRow<{ recovery_at: string }>(
      this.ctx.storage.sql.exec(
        `SELECT recovery_at FROM runtime_delays
         WHERE status = 'scheduled' AND execution_started_at IS NOT NULL
           AND recovery_at IS NOT NULL
         ORDER BY recovery_at LIMIT 1`,
      ),
    );
    if (!next) return;
    const timestamp = Date.parse(next.recovery_at);
    if (Number.isFinite(timestamp)) await this.scheduleAlarmAt(timestamp);
  }

  private reconcileExpiredDelayExecutions(now = new Date()): void {
    this.ctx.storage.sql.exec(
      `UPDATE runtime_delays SET execution_started_at = NULL, recovery_at = NULL
       WHERE status = 'scheduled' AND execution_started_at IS NOT NULL
         AND recovery_at IS NOT NULL AND recovery_at <= ?`,
      now.toISOString(),
    );
  }

  /**
   * Bound per-user SQLite growth without ever deleting work that still needs to
   * be delivered or resumed. Thirty days is the public retry/replay window;
   * administrative archives remain in D1/R2 independently of these receipts.
   */
  private compactRuntimeStorage(now = Date.now()): void {
    const cutoff = new Date(now - RUNTIME_RECEIPT_RETENTION_MS).toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM runtime_idempotency WHERE created_at < ?",
        cutoff,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM runtime_reset_idempotency WHERE created_at < ?",
        cutoff,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM runtime_outbox
         WHERE status = 'delivered' AND delivered_at IS NOT NULL
           AND delivered_at < ?`,
        cutoff,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM runtime_realtime_outbox
         WHERE status = 'delivered' AND delivered_at IS NOT NULL
           AND delivered_at < ?`,
        cutoff,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM runtime_delays
         WHERE status IN ('resumed', 'cancelled')
           AND COALESCE(resumed_at, created_at) < ?`,
        cutoff,
      );
    });
  }

  private snapshotFromState(
    row: StateRow,
    updatedBlocks: FlowSdkBlock[],
    duplicate: boolean,
  ): FlowRuntimeSnapshot {
    return {
      workflowId: row.workflow_id,
      ...(row.workflow_version_id
        ? { workflowVersionId: row.workflow_version_id }
        : {}),
      state: row.state,
      activeBlockIds: parseStringArray(row.active_block_ids_json),
      exitedBlockIds: [],
      updatedBlocks,
      ...(row.entered_at ? { enteredAt: row.entered_at } : {}),
      ...(row.exited_at ? { exitedAt: row.exited_at } : {}),
      duplicate,
    };
  }
}

function readTourUpdate(
  command: FlowRuntimeCommand,
  graph: FlowRuntimeCommand["graph"],
): { blockId: string; currentIndex: number } | null {
  if (command.event.name !== "tour-update") return null;
  const block = command.event.blockId
    ? graph.blocks.find((entry) => entry.id === command.event.blockId)
    : graph.blocks.find((entry) => entry.key === command.event.blockKey);
  const currentIndex = command.event.properties?.currentTourIndex;
  const steps = block && Array.isArray(block.data.steps)
    ? block.data.steps
    : block && Array.isArray(block.data.screens)
      ? block.data.screens
      : [];
  if (
    !block ||
    (block.type !== "tour" && block.type !== "tour-component") ||
    typeof currentIndex !== "number" ||
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    (steps.length > 0 && currentIndex >= steps.length)
  ) {
    throw new Error("Invalid tour update command");
  }
  return { blockId: block.id, currentIndex };
}

function applyMemoryUpdatesToGraph(
  graph: FlowRuntimeCommand["graph"],
  updates: ReadonlyMap<string, unknown>,
): FlowRuntimeCommand["graph"] {
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({
      ...block,
      propertyMeta: block.propertyMeta.map((property) =>
        property.type === "state-memory" && updates.has(property.key)
          ? { ...property, value: updates.get(property.key) }
          : property,
      ),
    })),
  };
}

function firstRow<T>(cursor: Iterable<T>): T | null {
  for (const row of cursor) return row;
  return null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseStringMap(value?: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function parseUnknownRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseUnknown(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function runtimeCommandHash(command: FlowRuntimeCommand): Promise<string> {
  const canonical = JSON.stringify({
    event: command.event,
    graph: command.graph,
    frequency: command.frequency,
    migrationStrategy: command.migrationStrategy,
    userProperties: command.userProperties,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function personalizeRuntimeGraph(
  graph: FlowRuntimeCommand["graph"],
  properties: Readonly<Record<string, unknown>>,
): FlowRuntimeCommand["graph"] {
  if (!Object.keys(properties).length) return graph;
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({
      ...block,
      data: personalizeValue(block.data, properties) as Record<string, unknown>,
      propertyMeta: block.propertyMeta.map((property) => ({
        ...property,
        ...(property.value === undefined
          ? {}
          : { value: personalizeValue(property.value, properties) }),
      })),
      ...(block.pageTargetingValues
        ? {
            pageTargetingValues: block.pageTargetingValues.map((value) =>
              String(personalizeValue(value, properties)),
            ),
          }
        : {}),
      ...(block.tourWait
        ? {
            tourWait: personalizeValue(
              block.tourWait,
              properties,
            ) as NonNullable<typeof block.tourWait>,
          }
        : {}),
      ...(block.tourTrigger
        ? {
            tourTrigger: personalizeValue(
              block.tourTrigger,
              properties,
            ) as NonNullable<typeof block.tourTrigger>,
          }
        : {}),
      ...(block.surveyQuestions
        ? {
            surveyQuestions: personalizeValue(
              block.surveyQuestions,
              properties,
            ) as NonNullable<typeof block.surveyQuestions>,
          }
        : {}),
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
