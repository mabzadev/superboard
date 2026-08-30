import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readBytesLimited } from "@superboard/contracts/request-body";
import type { Env } from "../types";
import type { FlowApp } from "./auth";
import { errorResponse } from "./errors";
import { replayProjectMutation } from "./idempotency";

type StoredRow = {
  projectId: number;
  scope: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseJson: string;
  createdAt: string;
};

class FakeD1 {
  readonly rows = new Map<string, StoredRow>();

  prepare(sql: string): D1PreparedStatement {
    const database = this;
    let bindings: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        bindings = values;
        return statement;
      },
      async first<T>(): Promise<T | null> {
        const row = database.first(sql, bindings);
        return (row ?? null) as T | null;
      },
      async run(): Promise<D1Result<unknown>> {
        return database.run(sql, bindings) as D1Result<unknown>;
      },
    };
    return statement as unknown as D1PreparedStatement;
  }

  seed(row: StoredRow): void {
    this.rows.set(this.storageKey(row.projectId, row.scope, row.key), row);
  }

  private first(sql: string, bindings: unknown[]): Record<string, unknown> | null {
    if (!sql.includes("FROM flow_idempotency_keys")) {
      throw new Error(`Unsupported first query: ${sql}`);
    }
    const [projectId, scope, key] = bindings as [number, string, string];
    const row = this.rows.get(this.storageKey(projectId, scope, key));
    return row
      ? {
          request_hash: row.requestHash,
          response_status: row.responseStatus,
          response_json: row.responseJson,
          created_at: row.createdAt,
        }
      : null;
  }

  private run(sql: string, bindings: unknown[]): { meta: { changes: number } } {
    if (sql.includes("INSERT OR IGNORE INTO flow_idempotency_keys")) {
      const [projectId, scope, key, requestHash, responseStatus, responseJson, createdAt] =
        bindings as [number, string, string, string, number, string, string];
      const storageKey = this.storageKey(projectId, scope, key);
      if (this.rows.has(storageKey)) return { meta: { changes: 0 } };
      this.rows.set(storageKey, {
        projectId,
        scope,
        key,
        requestHash,
        responseStatus,
        responseJson,
        createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET response_json = ?, created_at = ?")) {
      const hasCreatedAtGuard = sql.includes("AND created_at = ?");
      const [responseJson, createdAt, projectId, scope, key, requestHash,
        responseStatus, expectedResponse, expectedCreatedAt] = bindings as [
          string, string, number, string, string, string, number, string, string?,
        ];
      const row = this.rows.get(this.storageKey(projectId, scope, key));
      if (
        !row || row.requestHash !== requestHash ||
        row.responseStatus !== responseStatus || row.responseJson !== expectedResponse ||
        (hasCreatedAtGuard && row.createdAt !== expectedCreatedAt)
      ) return { meta: { changes: 0 } };
      row.responseJson = responseJson;
      row.createdAt = createdAt;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET response_status = ?, response_json = ?")) {
      const [responseStatus, responseJson, projectId, scope, key, requestHash,
        expectedStatus, expectedResponse] = bindings as [
          number, string, number, string, string, string, number, string,
        ];
      const row = this.rows.get(this.storageKey(projectId, scope, key));
      if (
        !row || row.requestHash !== requestHash ||
        row.responseStatus !== expectedStatus || row.responseJson !== expectedResponse
      ) return { meta: { changes: 0 } };
      row.responseStatus = responseStatus;
      row.responseJson = responseJson;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("DELETE FROM flow_idempotency_keys")) {
      const [projectId, scope, key, requestHash, responseStatus, responseJson] =
        bindings as [number, string, string, string, number, string];
      const storageKey = this.storageKey(projectId, scope, key);
      const row = this.rows.get(storageKey);
      if (
        !row || row.requestHash !== requestHash ||
        row.responseStatus !== responseStatus || row.responseJson !== responseJson
      ) return { meta: { changes: 0 } };
      this.rows.delete(storageKey);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unsupported run query: ${sql}`);
  }

  private storageKey(projectId: number, scope: string, key: string): string {
    return `${projectId}:${scope}:${key}`;
  }
}

describe("Flows project mutation idempotency", () => {
  it("atomically lets one concurrent request mutate and replays its exact response", async () => {
    const database = new FakeD1();
    let sideEffects = 0;
    const app = testApp(database, async () => {
      sideEffects += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(new Uint8Array([0, 1, 2, 255]), {
        status: 201,
        statusText: "Stored",
        headers: { "content-type": "application/octet-stream", "x-result": "created" },
      });
    });
    const request = () => app.request("https://flows.test/mutation", {
      method: "POST",
      headers: { "idempotency-key": "same-command", "content-type": "application/json" },
      body: JSON.stringify({ name: "Flow" }),
    }, environment(database));

    const [first, second] = await Promise.all([request(), request()]);

    expect(sideEffects).toBe(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.statusText).toBe("Stored");
    expect(second.statusText).toBe("Stored");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(first.headers.get("x-result")).toBe("created");
    expect(second.headers.get("x-result")).toBe("created");
    expect([first, second].filter(
      (response) => response.headers.get("idempotency-replayed") === "true",
    )).toHaveLength(1);
  });

  it("rejects reuse of a completed key for a different request payload", async () => {
    const database = new FakeD1();
    let sideEffects = 0;
    const app = testApp(database, () => {
      sideEffects += 1;
      return Response.json({ stored: true }, { status: 201 });
    });
    const send = (name: string) => app.request("https://flows.test/mutation", {
      method: "POST",
      headers: { "idempotency-key": "payload-key", "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }, environment(database));

    expect((await send("one")).status).toBe(201);
    const conflict = await send("two");

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "idempotency_key_conflict" },
    });
    expect(sideEffects).toBe(1);
  });

  it("recovers an expired crashed claim instead of blocking until retention purge", async () => {
    const database = new FakeD1();
    const body = JSON.stringify({ name: "recovered" });
    const request = new Request("https://flows.test/mutation?mode=replace", {
      method: "POST",
      headers: { "idempotency-key": "crashed-key", "content-type": "application/json" },
      body,
    });
    database.seed({
      projectId: 42,
      scope: "project-admin",
      key: "crashed-key",
      requestHash: await requestHash(request),
      responseStatus: 102,
      responseJson: JSON.stringify({
        kind: "claim",
        version: 1,
        owner: "crashed-worker",
        lease_expires_at: "2000-01-01T00:00:00.000Z",
      }),
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    let sideEffects = 0;
    const app = testApp(database, () => {
      sideEffects += 1;
      return Response.json({ recovered: true }, { status: 202 });
    });

    const response = await app.request(request, undefined, environment(database));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ recovered: true });
    expect(sideEffects).toBe(1);
    expect(database.rows.get("42:project-admin:crashed-key")?.responseStatus).toBe(202);
  });

  it("rejects an oversized request before claiming or running the mutation", async () => {
    const database = new FakeD1();
    let sideEffects = 0;
    const app = testApp(database, () => {
      sideEffects += 1;
      return Response.json({ stored: true });
    });

    const response = await app.request("https://flows.test/mutation", {
      method: "POST",
      headers: { "idempotency-key": "large-request" },
      body: new Uint8Array(1_048_577),
    }, environment(database));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(sideEffects).toBe(0);
    expect(database.rows.size).toBe(0);
  });

  it("bounds a streamed mutation response, releases its claim and reports the error", async () => {
    const database = new FakeD1();
    let sideEffects = 0;
    const app = testApp(database, () => {
      sideEffects += 1;
      let emitted = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted >= 17) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(65_536));
          emitted += 1;
        },
      }));
    });

    const response = await app.request("https://flows.test/mutation", {
      method: "POST",
      headers: { "idempotency-key": "large-response" },
    }, environment(database));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_response_too_large" },
    });
    expect(sideEffects).toBe(1);
    expect(database.rows.size).toBe(0);
  });
});

function testApp(
  database: FakeD1,
  mutation: () => Response | Promise<Response>,
): Hono<FlowApp> {
  const app = new Hono<FlowApp>();
  app.onError((error, context) => errorResponse(error, context));
  app.use("*", async (context, next) => {
    context.set("flowProject", {
      projectId: 42,
      projectRef: "42-test",
      createdAt: "2026-08-13T00:00:00.000Z",
      defaultEnvironment: { id: "environment", key: "test" },
    });
    await next();
  });
  app.use("*", replayProjectMutation());
  app.post("/mutation", async (context) => {
    context.res = await mutation();
  });
  return app;
}

function environment(database: FakeD1): Env {
  return { DB: database as unknown as D1Database } as Env;
}

async function requestHash(request: Request): Promise<string> {
  const body = await readBytesLimited(request.clone(), 1_048_576);
  const url = new URL(request.url);
  const prefix = new TextEncoder().encode(
    `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n`,
  );
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength);
  bytes.set(prefix);
  bytes.set(body, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
