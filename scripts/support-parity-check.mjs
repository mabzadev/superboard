#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = requestedRoot(process.argv.slice(2))
  ?? resolve(fileURLToPath(new URL("..", import.meta.url)));
const audit = resolve(root, "scripts/support-audit");
const capabilities = JSON.parse(await readFile(resolve(audit, "capabilities.json"), "utf8"));
const routes = JSON.parse(await readFile(resolve(audit, "reference-routes.json"), "utf8"));
const failures = [];
const allowed = new Set(["implemented", "delegated", "excluded"]);
const testRunners = Object.freeze({
  "vitest-support": {
    prefix: "workers/support/src/",
    file: /\.test\.ts$/u,
  },
  "vitest-workers": {
    prefix: "workers/support/runtime-tests/",
    file: /\.test\.ts$/u,
  },
  "vitest-api": {
    prefix: "workers/api/src/",
    file: /\.test\.ts$/u,
  },
  "vitest-dashboard": {
    prefix: "apps/dashboard/src/",
    file: /\.test\.tsx?$/u,
  },
  "playwright-dashboard": {
    prefix: "apps/dashboard/e2e/",
    file: /\.spec\.ts$/u,
  },
  "flutter-test": {
    prefix: "sdks/",
    file: /_test\.dart$/u,
  },
});

if (capabilities.schema_version !== 2) {
  failures.push("capability manifest schema_version must be 2");
}
if (capabilities.internal_only !== true || routes.internal_only !== true) {
  failures.push("audit manifests must be marked internal_only");
}
if (routes.reference_commit !== capabilities.reference.commit) failures.push("reference commit drift");
if (routes.route_method_count !== capabilities.reference.route_method_count) failures.push("reference route count drift");
if (routes.routes.length !== capabilities.reference.route_method_count) failures.push("reference route inventory is incomplete");
if (routes.canonical_route_sha256 !== capabilities.reference.canonical_route_sha256) failures.push("reference route digest drift");

const byId = new Map();
for (const capability of capabilities.capabilities || []) {
  if (!capability.id || byId.has(capability.id)) failures.push(`duplicate or missing capability id: ${capability.id || "<empty>"}`);
  byId.set(capability.id, capability);
  if (!allowed.has(capability.disposition)) failures.push(`${capability.id}: invalid disposition ${capability.disposition}`);
  if (!capability.authority) failures.push(`${capability.id}: authority is required`);
  if (capability.disposition === "implemented") {
    for (const dimension of ["behavior", "persistence", "asynchronous", "rbac", "interface", "tests"]) {
      const evidence = capability.dimensions?.[dimension];
      if (!Array.isArray(evidence) || evidence.length === 0) failures.push(`${capability.id}: ${dimension} evidence is required`);
      if (dimension === "tests") {
        for (const proof of evidence || []) await checkTestProof(capability.id, proof);
      } else {
        for (const file of evidence || []) await checkEvidence(capability.id, file);
      }
    }
  } else {
    if (!capability.reason) failures.push(`${capability.id}: ${capability.disposition} reason is required`);
    for (const file of [...(capability.contract || []), ...(capability.tests || [])]) await checkEvidence(capability.id, file);
    if (capability.disposition === "delegated" && (!(capability.contract?.length) || !(capability.tests?.length))) {
      failures.push(`${capability.id}: delegated capabilities require contract and test evidence`);
    }
  }
}

const fingerprints = new Set();
for (const route of routes.routes || []) {
  if (!route.fingerprint || fingerprints.has(route.fingerprint)) failures.push(`duplicate or missing route fingerprint: ${route.path || "<unknown>"}`);
  fingerprints.add(route.fingerprint);
  const capability = byId.get(route.capability);
  if (!capability) failures.push(`${route.fingerprint}: unmapped capability ${route.capability || "<empty>"}`);
  if (!allowed.has(route.disposition)) failures.push(`${route.fingerprint}: invalid route disposition`);
  if (capability && capability.disposition !== route.disposition) failures.push(`${route.fingerprint}: disposition disagrees with ${route.capability}`);
  if (!route.mapping_rule || route.mapping_rule === "unknown") failures.push(`${route.fingerprint}: mapping rule is missing`);
  const canonical = JSON.stringify({
    name: route.name ?? null,
    verb: route.verb,
    path: route.path,
    controller: route.controller ?? null,
    action: route.action ?? null,
    internal: route.internal === true,
  });
  if (createHash("sha256").update(canonical).digest("hex") !== route.fingerprint) failures.push(`${route.fingerprint}: route evidence was modified`);
}

if (failures.length) {
  console.error("SuperBoard Support parity gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const summary = Object.fromEntries([...allowed].map((status) => [status, routes.routes.filter((route) => route.disposition === status).length]));
console.log(JSON.stringify({ status: "ok", reference_routes: routes.routes.length, capabilities: byId.size, dispositions: summary }, null, 2));

async function checkEvidence(capability, file) {
  if (typeof file !== "string" || file.startsWith("/") || file.includes("..")) {
    failures.push(`${capability}: unsafe evidence path ${String(file)}`);
    return null;
  }
  const absolute = resolve(root, file);
  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      failures.push(`${capability}: evidence is not a regular file ${file}`);
      return null;
    }
    if (info.size === 0) {
      failures.push(`${capability}: empty evidence file ${file}`);
      return null;
    }
    return await readFile(absolute, "utf8");
  } catch {
    failures.push(`${capability}: missing evidence ${file}`);
    return null;
  }
}

async function checkTestProof(capability, proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    failures.push(`${capability}: test evidence must be an executable proof object`);
    return;
  }
  const keys = Object.keys(proof);
  const unknown = keys.find((key) => !["file", "runner", "behavior_tokens"].includes(key));
  if (unknown) failures.push(`${capability}: unknown test proof field ${unknown}`);
  const file = proof.file;
  const runner = typeof proof.runner === "string"
    && Object.hasOwn(testRunners, proof.runner)
    ? testRunners[proof.runner]
    : null;
  if (!runner) {
    failures.push(`${capability}: unsupported test runner ${String(proof.runner)}`);
  } else if (
    typeof file !== "string"
    || !file.startsWith(runner.prefix)
    || !runner.file.test(file)
  ) {
    failures.push(`${capability}: ${String(file)} is not executable by ${proof.runner}`);
  }
  const source = await checkEvidence(capability, file);
  if (source === null) return;
  const compact = source.replace(/\s+/gu, " ").trim();
  if (compact.length < 120) {
    failures.push(`${capability}: test evidence is empty or too small to prove behavior ${file}`);
  }
  if (!/\b(?:it|test)\s*\(/u.test(source)) {
    failures.push(`${capability}: test evidence has no executable test case ${file}`);
  }
  if (
    /\b(?:TODO|FIXME|PLACEHOLDER|NOT[ _-]?IMPLEMENTED)\b/iu.test(source)
    || /expect\(\s*true\s*\)\s*\.\s*toBe\(\s*true\s*\)/u.test(source)
  ) {
    failures.push(`${capability}: placeholder test evidence is forbidden ${file}`);
  }
  const tokens = proof.behavior_tokens;
  if (!Array.isArray(tokens) || tokens.length < 2) {
    failures.push(`${capability}: at least two behavioral tokens are required for ${file}`);
    return;
  }
  const unique = new Set();
  for (const token of tokens) {
    if (
      typeof token !== "string"
      || token.length < 8
      || token.length > 240
      || token.trim() !== token
    ) {
      failures.push(`${capability}: invalid behavioral token in ${file}`);
      continue;
    }
    if (unique.has(token)) {
      failures.push(`${capability}: duplicate behavioral token in ${file}: ${token}`);
      continue;
    }
    unique.add(token);
    if (!source.includes(token)) {
      failures.push(`${capability}: missing behavioral token in ${file}: ${token}`);
    }
  }
}

function requestedRoot(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--root" && args[1]) {
    return resolve(args[1]);
  }
  throw new Error("Usage: support-parity-check.mjs [--root <workspace>]");
}
