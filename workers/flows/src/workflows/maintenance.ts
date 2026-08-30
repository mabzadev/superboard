import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type {
  FlowGraph,
  FlowWorkflowFrequency,
  FlowWorkflowMigrationStrategy,
} from "@superboard/contracts/flows";
import { flowRuntimeName } from "../runtime/names";
import type { Env, FlowMaintenancePayload } from "../types";

type ReleaseMigration = {
  project_ref: string;
  frequency: FlowWorkflowFrequency;
  workflow_version_id: string;
  migration_strategy: FlowWorkflowMigrationStrategy;
  graph_json: string;
};

export class FlowMaintenanceExecution extends WorkflowEntrypoint<
  Env,
  FlowMaintenancePayload
> {
  async run(
    event: Readonly<WorkflowEvent<FlowMaintenancePayload>>,
    step: WorkflowStep,
  ): Promise<Record<string, unknown>> {
    switch (event.payload.operation) {
      case "export":
        return this.exportEvents(event.payload, step);
      case "purge":
        return step.do("purge-expired-control-records", async () => {
          const [idempotency, receipts] = await this.env.DB.batch([
            this.env.DB.prepare(
              `DELETE FROM flow_idempotency_keys
               WHERE project_id = ? AND created_at < datetime('now', '-30 days')`,
            ).bind(event.payload.projectId),
            this.env.DB.prepare(
              `DELETE FROM flow_outbox_receipts
               WHERE project_id = ? AND status IN ('projected', 'duplicate')
                 AND received_at < datetime('now', '-30 days')`,
            ).bind(event.payload.projectId),
          ]);
          return {
            idempotency_keys: idempotency.meta.changes,
            outbox_receipts: receipts.meta.changes,
          };
        });
      case "rebuild-rollups":
        return step.do("verify-projection-counts", async () => {
          const row = await this.env.DB.prepare(
            `SELECT COUNT(*) AS events,
              COUNT(DISTINCT user_id_hash) AS users
             FROM flow_analytics_events WHERE project_id = ?`,
          )
            .bind(event.payload.projectId)
            .first<{ events: number; users: number }>();
          return {
            events: Number(row?.events ?? 0),
            users: Number(row?.users ?? 0),
          };
        });
      case "migrate-release":
        return this.migrateRelease(event.payload, step);
    }
  }

  /**
   * Applies a release policy to already projected users immediately. The
   * Durable Object remains authoritative and repeats the same policy on the
   * next SDK command, so a temporarily delayed D1 projection cannot cause a
   * missed migration.
   */
  private async migrateRelease(
    payload: Readonly<FlowMaintenancePayload>,
    step: WorkflowStep,
  ): Promise<Record<string, unknown>> {
    if (
      !payload.environmentId ||
      !payload.workflowId ||
      !payload.workflowVersionId
    ) {
      throw new Error("Release migration payload is incomplete");
    }
    const release = await step.do("load-active-release", async () => {
      return this.env.DB.prepare(
        `SELECT p.project_ref, w.frequency,
          CASE WHEN r.use_draft = 1
            THEN 'draft:' || CAST(d.revision AS TEXT) ELSE v.id END
            AS workflow_version_id,
          CASE WHEN r.use_draft = 1 THEN 'finish-current'
            ELSE COALESCE(v.migration_strategy, 'finish-current') END
            AS migration_strategy,
          CASE WHEN r.use_draft = 1 THEN d.graph_json ELSE v.graph_json END
            AS graph_json
         FROM flow_environment_releases r
         JOIN flow_projects p ON p.project_id = r.project_id
         JOIN flow_workflows w
           ON w.project_id = r.project_id AND w.id = r.workflow_id
         LEFT JOIN flow_workflow_drafts d ON d.workflow_id = r.workflow_id
         LEFT JOIN flow_workflow_versions v ON v.id = r.workflow_version_id
         WHERE r.project_id = ? AND r.environment_id = ?
           AND r.workflow_id = ? AND r.active = 1
         LIMIT 1`,
      ).bind(
        payload.projectId,
        payload.environmentId,
        payload.workflowId,
      ).first<ReleaseMigration>();
    });
    // A newer activation superseded this job. It must not mutate users for the
    // new release using an obsolete graph or migration policy.
    if (!release || release.workflow_version_id !== payload.workflowVersionId) {
      return { migrated_users: 0, superseded: true };
    }

    const population = release.migration_strategy === "restart-all"
      ? "state IN ('not-started', 'in-progress', 'completed', 'stopped')"
      : "state = 'in-progress'";
    const total = await step.do("count-release-migration-users", async () => {
      const row = await this.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM flow_user_workflow_states
         WHERE project_id = ? AND environment_id = ?
           AND workflow_id = ? AND (${population})
           AND (workflow_version_id IS NULL OR workflow_version_id != ?)`,
      ).bind(
        payload.projectId,
        payload.environmentId,
        payload.workflowId,
        release.workflow_version_id,
      ).first<{ count: number }>();
      return Number(row?.count ?? 0);
    });

    const graph = JSON.parse(release.graph_json) as FlowGraph;
    const pageSize = 100;
    let migratedUsers = 0;
    let cursor = "";
    const pageCount = Math.ceil(total / pageSize);
    for (let page = 0; page < pageCount; page += 1) {
      const result = await step.do(
        `migrate-release-users-${page}`,
        {
          retries: { limit: 8, delay: "10 seconds", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const rows = await this.env.DB.prepare(
            `SELECT user_id_hash FROM flow_user_workflow_states
             WHERE project_id = ? AND environment_id = ?
               AND workflow_id = ? AND (${population})
               AND (workflow_version_id IS NULL OR workflow_version_id != ?)
               AND user_id_hash > ?
             ORDER BY user_id_hash LIMIT ?`,
          ).bind(
            payload.projectId,
            payload.environmentId,
            payload.workflowId,
            release.workflow_version_id,
            cursor,
            pageSize,
          ).all<{ user_id_hash: string }>();
          let migrated = 0;
          for (let index = 0; index < rows.results.length; index += 25) {
            const batch = rows.results.slice(index, index + 25);
            await Promise.all(
              batch.map((row) => {
                const runtime = this.env.FLOW_USER_RUNTIME.getByName(
                  flowRuntimeName(
                    payload.projectId,
                    payload.environmentId!,
                    row.user_id_hash,
                  ),
                );
                return runtime.execute({
                  event: {
                    schemaVersion: 1,
                    eventId: `${payload.id}:${row.user_id_hash}`,
                    projectId: payload.projectId,
                    projectRef: release.project_ref,
                    environmentId: payload.environmentId!,
                    userIdHash: row.user_id_hash,
                    name: "identify",
                    occurredAt: new Date().toISOString(),
                    workflowId: payload.workflowId!,
                    workflowVersionId: release.workflow_version_id,
                  },
                  graph,
                  frequency: release.frequency,
                  migrationStrategy: release.migration_strategy,
                  userProperties: {},
                });
              }),
            );
            migrated += batch.length;
          }
          return {
            migrated,
            last_user_id_hash: rows.results.at(-1)?.user_id_hash ?? cursor,
            selected: rows.results.length,
          };
        },
      );
      migratedUsers += result.migrated;
      cursor = result.last_user_id_hash;
      if (result.selected < pageSize) break;
    }
    return {
      migrated_users: migratedUsers,
      selected_users: total,
      strategy: release.migration_strategy,
      workflow_version_id: release.workflow_version_id,
      superseded: false,
    };
  }

  private async exportEvents(
    payload: Readonly<FlowMaintenancePayload>,
    step: WorkflowStep,
  ): Promise<Record<string, unknown>> {
    const exportId = payload.exportId ?? payload.id;
    await step.do("mark-export-running", async () => {
      await this.env.DB.prepare(
        `UPDATE flow_exports SET status = 'running', error_message = NULL
         WHERE id = ? AND project_id = ?`,
      )
        .bind(exportId, payload.projectId)
        .run();
    });
    const result = await step.do(
      "write-event-archive",
      { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } },
      async () => {
        const key = `v1/archives/project=${payload.projectId}/events/${exportId}.ndjson`;
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        const encoder = new TextEncoder();
        let rowCount = 0;
        const producer = (async () => {
          try {
            let cursorOccurredAt: string | null = null;
            let cursorEventId: string | null = null;
            for (;;) {
              const cursorClause: string = cursorOccurredAt && cursorEventId
                ? "AND (occurred_at > ? OR (occurred_at = ? AND event_id > ?))"
                : "";
              const bindings: unknown[] = [payload.projectId];
              if (cursorOccurredAt && cursorEventId) {
                bindings.push(cursorOccurredAt, cursorOccurredAt, cursorEventId);
              }
              const page: D1Result<Record<string, unknown>> = await this.env.DB.prepare(
                `SELECT event_id, project_ref, environment_id,
                  user_id_hash, event_name, workflow_id, workflow_version_id,
                  block_id, block_key, properties_json, legacy_event_type,
                  source_event_id, source_module, occurred_at
                 FROM flow_analytics_events WHERE project_id = ?
                   ${cursorClause}
                 ORDER BY occurred_at, event_id LIMIT 1000`,
              ).bind(...bindings).all<Record<string, unknown>>();
              if (!page.results.length) break;
              await writer.write(encoder.encode(
                `${page.results.map((row) => JSON.stringify(row)).join("\n")}\n`,
              ));
              rowCount += page.results.length;
              const last: Record<string, unknown> = page.results.at(-1)!;
              cursorOccurredAt = String(last.occurred_at);
              cursorEventId = String(last.event_id);
              if (page.results.length < 1000) break;
            }
            await writer.close();
          } catch (error) {
            await writer.abort(error);
            throw error;
          }
        })();
        await Promise.all([
          producer,
          this.env.ARCHIVE.put(key, stream.readable, {
            httpMetadata: { contentType: "application/x-ndjson" },
            customMetadata: {
              projectId: String(payload.projectId),
              exportId,
            },
          }),
        ]);
        return { key, rows: rowCount };
      },
    );
    await step.do("mark-export-complete", async () => {
      await this.env.DB.prepare(
        `UPDATE flow_exports SET status = 'completed', r2_key = ?,
          completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ?`,
      )
        .bind(String(result.key), exportId, payload.projectId)
        .run();
    });
    return result;
  }
}
