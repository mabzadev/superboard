import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { d1RuntimeBindings } from "../../../scripts/cloudflare-vitest-d1.mjs";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here("."),
  plugins: [
    cloudflareTest(async () => {
      const migrations = [
        ...(await readD1Migrations(here("./runtime-tests/migrations"))),
        ...(await readD1Migrations(here("./migrations"))),
      ];
      return {
        wrangler: { configPath: here("./wrangler.jsonc") },
        miniflare: {
          bindings: {
            CUSTOM_WORKER_TOKEN: "custom-runtime-secret",
            FILES_INTERNAL_TOKEN: "files-runtime-secret",
            FILES_INPUT_ORIGIN: "https://files.example.test",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            VOCALS_ORCHESTRATOR: async () =>
              Response.json({ status: "started" }, { status: 202 }),
            MEDIAS_ORCHESTRATOR: async () =>
              Response.json({ status: "started" }, { status: 202 }),
            FILES_SERVICE: async (request) => {
              if (
                request.headers.get("x-internal-token") !==
                  "files-runtime-secret" ||
                request.headers.get("x-file-owner") !== "user-1"
              ) {
                return Response.json(
                  { error: { code: "unauthorized" } },
                  { status: 401 },
                );
              }
              return Response.json({
                download: {
                  url: "https://files.example.test/v1/downloads/runtime-ticket",
                },
              });
            },
          },
        },
      };
    }),
  ],
  test: {
    include: ["runtime-tests/**/*.test.ts"],
    setupFiles: ["./runtime-tests/apply-migrations.ts"],
    sequence: { concurrent: false },
  },
});
