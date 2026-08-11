#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  flutterFlowSourceEvidence,
  verifyFlutterFlowSource,
} from "./flutterflow-source-verify.mjs";

const receiptSchema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../schemas/flutterflow-client-release.schema.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
const validateReceiptSchema = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(receiptSchema);

export function createFlutterFlowClientReceipt({
  manifestPath,
  sourcePath,
  issuedAt = new Date().toISOString(),
}) {
  const verification = verifyFlutterFlowSource({ manifestPath, sourcePath });
  if (!verification.ready || verification.convergence?.ready !== true) {
    throw new Error("FlutterFlow client convergence is not ready for release");
  }
  const manifest = readJson(manifestPath, "FlutterFlow snapshot manifest");
  const evidence = flutterFlowSourceEvidence({
    sourceRoot: sourcePath,
    policy: manifest.convergence,
  });
  const checks = verification.convergence.checks;
  const receipt = {
    $schema: "../../schemas/flutterflow-client-release.schema.json",
    schemaVersion: 1,
    status: "accepted",
    application: verification.application,
    project: verification.project,
    flutterflowCommitId: verification.export.commitId,
    sourceSnapshotSha256: snapshotHash(manifest),
    convergencePolicySha256: sha256Canonical(manifest.convergence),
    sourceEvidence: evidence,
    checks: {
      total: checks.length,
      passed: checks.filter(({ ready }) => ready).length,
      blocked: 0,
    },
    diagnostics: {
      total: verification.diagnostics.total,
      validationErrors: verification.diagnostics.validationErrors,
    },
    issuedAt,
  };
  validateReceipt(receipt);
  return receipt;
}

export function verifyFlutterFlowClientReceipt({
  manifestPath,
  receiptPath,
  sourcePath = null,
}) {
  const manifest = readJson(manifestPath, "FlutterFlow snapshot manifest");
  const receipt = readJson(receiptPath, "FlutterFlow client release receipt");
  validateReceipt(receipt);
  const expectedChecks = manifest.convergence?.checks?.length || 0;
  const assertions = [
    [receipt.application === manifest.application, "application"],
    [canonical(receipt.project) === canonical(manifest.project), "project"],
    [
      receipt.flutterflowCommitId === manifest.export?.commitId,
      "FlutterFlow commit",
    ],
    [receipt.sourceSnapshotSha256 === snapshotHash(manifest), "snapshot hash"],
    [
      receipt.convergencePolicySha256 === sha256Canonical(manifest.convergence),
      "convergence policy hash",
    ],
    [receipt.checks.total === expectedChecks, "check count"],
    [receipt.checks.passed === expectedChecks, "passed check count"],
    [receipt.checks.blocked === 0, "blocked check count"],
    [
      receipt.diagnostics.total === manifest.diagnostics?.total,
      "diagnostic count",
    ],
    [
      receipt.diagnostics.validationErrors ===
        manifest.diagnostics?.validationErrors,
      "validation diagnostic count",
    ],
    [Number.isFinite(Date.parse(receipt.issuedAt)), "issue timestamp"],
  ];
  const failed = assertions
    .filter(([ready]) => !ready)
    .map(([, label]) => label);
  if (failed.length > 0) {
    throw new Error(
      `FlutterFlow client release receipt mismatch: ${failed.join(", ")}`,
    );
  }
  if (sourcePath) {
    const verification = verifyFlutterFlowSource({ manifestPath, sourcePath });
    if (!verification.ready || verification.convergence?.ready !== true) {
      throw new Error(
        "FlutterFlow client source no longer satisfies convergence",
      );
    }
    const evidence = flutterFlowSourceEvidence({
      sourceRoot: sourcePath,
      policy: manifest.convergence,
    });
    if (canonical(evidence) !== canonical(receipt.sourceEvidence)) {
      throw new Error(
        "FlutterFlow client source evidence does not match the receipt",
      );
    }
  }
  return {
    schemaVersion: 1,
    ready: true,
    application: receipt.application,
    project: receipt.project,
    flutterflowCommitId: receipt.flutterflowCommitId,
    sourceVerified: Boolean(sourcePath),
    checks: receipt.checks,
    diagnostics: receipt.diagnostics,
    issuedAt: receipt.issuedAt,
  };
}

function validateReceipt(receipt) {
  if (!validateReceiptSchema(receipt)) {
    const details = (validateReceiptSchema.errors || [])
      .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid FlutterFlow client release receipt: ${details}`);
  }
}

function snapshotHash(manifest) {
  return sha256Canonical({
    schemaVersion: manifest.schemaVersion,
    application: manifest.application,
    project: manifest.project,
    export: manifest.export,
    fingerprints: manifest.fingerprints,
    inventory: manifest.inventory,
    diagnostics: manifest.diagnostics,
    convergence: manifest.convergence,
  });
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${label}: ${message}`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "generate") {
      const receipt = createFlutterFlowClientReceipt({
        manifestPath: requiredArgument("manifest"),
        sourcePath: requiredArgument("source"),
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    } else if (command === "verify") {
      const result = verifyFlutterFlowClientReceipt({
        manifestPath: requiredArgument("manifest"),
        receiptPath: requiredArgument("receipt"),
        sourcePath: argument("source"),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw new Error("Command must be generate or verify");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
