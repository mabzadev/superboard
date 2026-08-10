import assert from "node:assert/strict";
import test from "node:test";
import {
  CHATWOOT_BACKUPS,
  chatwootConfirmation,
  validateChatwootApplySafety,
} from "./apply.mjs";

function window() {
  return {
    schema_version: 1,
    window_id: "chatwoot-window-2026",
    starts_at: "2026-08-08T10:00:00.000Z",
    ends_at: "2026-08-08T14:00:00.000Z",
    opengrow_maintenance: { enabled: true },
    chatwoot_maintenance: { enabled: true },
    backup_receipt: {
      artifacts: CHATWOOT_BACKUPS.map((name) => ({ name, bytes: 10, sha256: "a".repeat(64) })),
    },
  };
}

test("Chatwoot production apply requires exact confirmation, maintenance and four backups", () => {
  const confirm = chatwootConfirmation("vocostar", "production", 12, "chatwoot-window-2026");
  assert.deepEqual(validateChatwootApplySafety({
    targetName: "vocostar", environment: "production", projectId: 12,
    window: window(), confirm, allowProduction: true,
    now: new Date("2026-08-08T12:00:00.000Z"),
  }), { windowId: "chatwoot-window-2026" });
  assert.throws(() => validateChatwootApplySafety({
    targetName: "vocostar", environment: "production", projectId: 12,
    window: window(), confirm: "wrong", allowProduction: true,
    now: new Date("2026-08-08T12:00:00.000Z"),
  }), /pass --confirm/u);
  const missing = window();
  missing.backup_receipt.artifacts.pop();
  assert.throws(() => validateChatwootApplySafety({
    targetName: "vocostar", environment: "production", projectId: 12,
    window: missing, confirm, allowProduction: true,
    now: new Date("2026-08-08T12:00:00.000Z"),
  }), /module-support/u);
});
