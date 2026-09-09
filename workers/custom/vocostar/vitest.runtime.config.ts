import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
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
            VOCOSTAR_INTERNAL_CALLBACK_TOKEN: "runtime-callback-current",
            VOCOSTAR_INTERNAL_CALLBACK_TOKEN_PREVIOUS: "runtime-callback-previous",
            VOCOSTAR_LEGACY_JWT_SECRET: "runtime-legacy-jwt-current",
            VOCOSTAR_LEGACY_JWT_SECRET_PREVIOUS: "runtime-legacy-jwt-previous",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            VOCOSTAR_NOTIFICATION_DISPATCHER: "legacy-vocostar-runtime",
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
          durableObjects: {
            VOCOSTAR_USER_VOCALS_ROOM: { className: "UserVocalsRoom", scriptName: "legacy-vocostar-runtime" },
            VOCOSTAR_USER_MEDIAS_ROOM: { className: "UserMediasRoom", scriptName: "legacy-vocostar-runtime" },
          },
          workers: [{
            name: "legacy-vocostar-runtime",
            modules: true,
            script: readFileSync(here("./runtime-tests/fixtures/legacy-runtime.mjs"), "utf8"),
            compatibilityDate: "2026-08-08",
            d1Databases: { DB: "00000000-0000-0000-0000-000000000001" },
            durableObjects: {
              USER_VOCALS_ROOM: { className: "UserVocalsRoom" },
              USER_MEDIAS_ROOM: { className: "UserMediasRoom" },
            },
          }],
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
