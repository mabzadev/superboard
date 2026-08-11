import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadAndValidateFlutterFlowClientInventory,
  validateFlutterFlowClientInventory,
} from "./flutterflow-client-inventory.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("VocoStar AS-IS inventory is exhaustive, classified and linked", () => {
  const result = loadAndValidateFlutterFlowClientInventory(
    resolve(root, "config/flutterflow-inventories/vocostar.json"),
  );
  assert.deepEqual(result.counts, {
    pages: 23,
    components: 17,
    appState: 34,
    structs: 9,
    apiCalls: 9,
    actionBlocks: 6,
    appEvents: 4,
    customActions: 30,
    customFunctions: 7,
    customWidgets: 7,
  });
  assert.deepEqual(result.classifications, [
    "common",
    "configurable",
    "remove",
    "vocostar",
  ]);
  assert.equal(result.gates, 35);
  assert.equal(result.historicalRemovedActions, 2);
  assert.deepEqual(result.appStatePersistence, { persisted: 27, transient: 7 });
  assert.equal(result.receiptStatus, "reviewed-export-receipt-replaced");
});

test("inventory rejects missing entities, duplicates, unknown replacements and cross-phase gates", async () => {
  const values = await fixtures();
  const missing = structuredClone(values.manifest);
  missing.inventory.pages[1].names.pop();
  assert.throws(() => validate(missing, values), /Expected 23 pages/u);

  const renamed = structuredClone(values.manifest);
  renamed.inventory.pages[0].names[0] = "inventedPage";
  assert.throws(
    () => validate(renamed, values),
    /names differ from reviewed AS-IS/u,
  );

  const duplicate = structuredClone(values.manifest);
  duplicate.inventory.components[1].names.push("Header");
  assert.throws(
    () => validate(duplicate, values),
    /Duplicate components inventory name/u,
  );

  const symbol = structuredClone(values.manifest);
  symbol.inventory.customActions[0].replacementSymbols.push("notPublic");
  assert.throws(() => validate(symbol, values), /unknown replacement/u);

  const gate = structuredClone(values.manifest);
  gate.inventory.pages[0].gate = "billing-authority-wired";
  assert.throws(
    () => validate(gate, values),
    /outside phase identity-runtime/u,
  );
});

function validate(manifest, values) {
  return validateFlutterFlowClientInventory({ ...values, manifest });
}

async function fixtures() {
  const read = async (path) =>
    JSON.parse(await readFile(resolve(root, path), "utf8"));
  return {
    manifest: await read("config/flutterflow-inventories/vocostar.json"),
    snapshot: await read("config/flutterflow-sources/vocostar.json"),
    migrationPlan: await read("config/flutterflow-migrations/vocostar.json"),
    surface: await read("config/flutterflow-custom-code.json"),
  };
}
