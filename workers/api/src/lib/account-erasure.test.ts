import { describe, expect, it, vi } from "vitest";
import {
  AccountErasureError,
  eraseApplicationAccount,
} from "./account-erasure";
import type { Env } from "../types";

describe("application account erasure coordinator", () => {
  it("erases every configured subject store and revokes Identity last", async () => {
    const logger = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const database = erasureDatabase();
    const calls: Array<{ service: string; request: Request }> = [];
    const environment = erasureEnv(database.db, calls);

    const result = await eraseApplicationAccount(
      environment,
      project(),
      "application-user-1",
      "request-1",
    );

    expect(result).toMatchObject({
      status: "completed",
      completedSteps: [
        "app",
        "analytics",
        "marketing",
        "support",
        "custom",
        "billing",
        "identity",
      ],
    });
    expect(calls.map(({ service }) => service)).toEqual(result.completedSteps);
    expect(calls.at(-1)?.service).toBe("identity");
    expect(calls[0].request.headers.get("x-project-ref")).toBe("10-test");
    expect(calls[0].request.headers.get("x-context-signature")).toMatch(
      /^[A-Za-z0-9_-]+$/u,
    );
    expect(calls[4].request.headers.get("x-custom-worker-subject")).toBe(
      "application-user-1",
    );
    expect(database.row?.application_user_id).toBeNull();
    expect(database.row?.status).toBe("completed");
    const completionLog = logger.mock.calls
      .flat()
      .map(String)
      .find((entry) => entry.includes("application_account_erasure_completed"));
    expect(completionLog).toContain(
      String(database.row?.application_user_hash).slice(0, 12),
    );
    expect(completionLog).not.toContain("application-user-1");
    expect(completionLog).not.toContain(
      String(database.row?.application_user_hash),
    );
    logger.mockRestore();
  });

  it("persists completed steps and resumes without replaying them after a dependency failure", async () => {
    const database = erasureDatabase();
    const calls: Array<{ service: string; request: Request }> = [];
    let marketingAvailable = false;
    const environment = erasureEnv(database.db, calls, (service) =>
      service === "marketing" && !marketingAvailable
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json({ data: { erased: true } }),
    );

    await expect(
      eraseApplicationAccount(
        environment,
        project(),
        "application-user-2",
        "request-2",
      ),
    ).rejects.toMatchObject<AccountErasureError>({
      code: "marketing_erasure_failed",
      service: "marketing",
    });
    expect(database.row?.status).toBe("failed");
    expect(JSON.parse(database.row?.completed_steps_json || "[]")).toEqual([
      "app",
      "analytics",
    ]);

    marketingAvailable = true;
    calls.length = 0;
    const resumed = await eraseApplicationAccount(
      environment,
      project(),
      "application-user-2",
      "request-2-retry",
    );
    expect(resumed.status).toBe("completed");
    expect(calls.map(({ service }) => service)).toEqual([
      "marketing",
      "support",
      "custom",
      "billing",
      "identity",
    ]);
  });
});

function project() {
  return {
    projectId: 12,
    instanceId: 10,
    projectRef: "10-test",
    environment: "test" as const,
  };
}

function erasureEnv(
  db: D1Database,
  calls: Array<{ service: string; request: Request }>,
  response: (service: string) => Response = () =>
    Response.json({ data: { erased: true } }),
): Env {
  const fetcher = (service: string) => ({
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push({ service, request });
      return response(service);
    }),
  });
  return {
    DB: db,
    MODULE_INTERNAL_TOKEN: "module-secret",
    CUSTOM_WORKER_TOKEN: "custom-secret",
    APP_MODULE: fetcher("app"),
    ANALYTICS_MODULE: fetcher("analytics"),
    MARKETING_MODULE: fetcher("marketing"),
    SUPPORT_MODULE: fetcher("support"),
    CUSTOM_WORKER: fetcher("custom"),
    BILLING: fetcher("billing"),
    IDENTITY_SERVICE: fetcher("identity"),
  } as unknown as Env;
}

function erasureDatabase() {
  type Row = {
    id: string;
    project_id: number;
    instance_id: number;
    project_ref: string;
    application_user_id: string | null;
    application_user_hash: string;
    status: "processing" | "failed" | "completed";
    completed_steps_json: string;
    lease_id: string | null;
    lease_expires_at: string | null;
  };
  let row: Row | null = null;
  const execute = async (
    operation: "first" | "all" | "run",
    sql: string,
    args: unknown[],
  ): Promise<unknown> => {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    if (
      operation === "run" &&
      normalized.startsWith("INSERT INTO application_account_erasures")
    ) {
      row ??= {
        id: String(args[0]),
        project_id: Number(args[1]),
        instance_id: Number(args[2]),
        project_ref: String(args[3]),
        application_user_id: String(args[4]),
        application_user_hash: String(args[5]),
        status: "processing",
        completed_steps_json: "[]",
        lease_id: null,
        lease_expires_at: null,
      };
      return changed(1);
    }
    if (
      operation === "first" &&
      normalized.startsWith("SELECT * FROM application_account_erasures")
    ) {
      return row;
    }
    if (
      operation === "first" &&
      normalized.startsWith(
        "UPDATE application_account_erasures SET status = 'processing'",
      )
    ) {
      if (!row || row.status === "completed" || row.lease_id) return null;
      row.status = "processing";
      row.lease_id = String(args[0]);
      row.lease_expires_at = "2099-01-01T00:00:00.000Z";
      return { ...row };
    }
    if (
      operation === "run" &&
      normalized.includes("completed_steps_json = ?") &&
      normalized.includes("lease_expires_at = datetime")
    ) {
      if (!row || row.lease_id !== args[2]) return changed(0);
      row.completed_steps_json = String(args[0]);
      return changed(1);
    }
    if (operation === "run" && normalized.includes("status = 'completed'")) {
      if (!row || row.lease_id !== args[2]) return changed(0);
      row.status = "completed";
      row.application_user_id = null;
      row.completed_steps_json = String(args[0]);
      row.lease_id = null;
      row.lease_expires_at = null;
      return changed(1);
    }
    if (operation === "run" && normalized.includes("status = 'failed'")) {
      if (!row || row.lease_id !== args[4]) return changed(0);
      row.status = "failed";
      row.completed_steps_json = String(args[0]);
      row.lease_id = null;
      row.lease_expires_at = null;
      return changed(1);
    }
    if (
      operation === "all" &&
      normalized.startsWith("SELECT * FROM application_account_erasures")
    ) {
      return { results: row ? [row] : [] };
    }
    throw new Error(`Unhandled account-erasure D1 ${operation}: ${normalized}`);
  };
  const db = {
    prepare(sql: string) {
      const statement = (args: unknown[]) => ({
        first: () => execute("first", sql, args),
        all: () => execute("all", sql, args),
        run: () => execute("run", sql, args),
      });
      return {
        bind: (...args: unknown[]) => statement(args),
        ...statement([]),
      };
    },
  } as unknown as D1Database;
  return {
    db,
    get row() {
      return row;
    },
  };
}

function changed(changes: number) {
  return { success: true, meta: { changes } };
}
