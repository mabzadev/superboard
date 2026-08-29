#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = requestedRoot(process.argv.slice(2))
  ?? resolve(fileURLToPath(new URL("..", import.meta.url)));
const sources = [
  "README.md",
  "apps/reference/README.md",
  "apps/reference/docs",
  "apps/dashboard/src",
  "sdks/javascript/README.md",
  "sdks/javascript/src",
  "sdks/javascript/dist",
  "sdks/flutter/README.md",
  "sdks/flutter/lib",
  "sdks/flutterflow/README.md",
  "sdks/flutterflow/lib",
  "sdks/flutterflow_messaging/README.md",
  "sdks/flutterflow_messaging/lib",
  "workers/api/src",
  "workers/support/src",
  "workers/email/src",
  "packages/contracts/src",
  "packages/contracts/fixtures"
];
const extensions = new Set([".css", ".dart", ".html", ".js", ".json", ".jsx", ".map", ".md", ".mjs", ".svg", ".ts", ".tsx", ".xml", ".yaml", ".yml"]);
const forbidden = [
  ["upstream product name", /\b(?:openchat|chatwoot)\b/iu],
  ["upstream realtime protocol", /\baction[ _-]?cable\b/iu],
  ["upstream storage protocol", /\bactive[ _-]?storage\b/iu],
  ["upstream account route", /\/api\/v1\/accounts(?:\/|\b)/iu],
  ["framework route", /\/rails(?:\/|\b)/iu],
  ["upstream telephony route", /\/twilio(?:\/|\b)/iu]
];
const supportSurfaceForbidden = [
  ["migration vocabulary", /\b(?:legacy|migration|parity|upstream)/iu],
  ["public compatibility banner", /\b(?:compatibility mode|migration status|migration progress)\b/iu],
];
const artifactSources = [
  "apps/dashboard/.next",
  "apps/dashboard/.open-next",
  "apps/dashboard/out",
];
const failures = [];

for (const source of sources) {
  const absolute = resolve(root, source);
  let info;
  try { info = await stat(absolute); } catch { continue; }
  const files = info.isDirectory() ? await walk(absolute) : [absolute];
  for (const file of files) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (!extensions.has(extname(file)) || ignored(rel)) continue;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const [label, pattern] of forbidden) {
        if (pattern.test(line)) failures.push(`${rel}:${index + 1}: ${label}`);
      }
      if (isPublishedSupportSurface(rel)) {
        for (const [label, pattern] of supportSurfaceForbidden) {
          if (pattern.test(line)) failures.push(`${rel}:${index + 1}: ${label}`);
        }
      }
    }
  }
}

// Audit inventories intentionally contain upstream names, private route
// fingerprints and the pinned reference commit. They are valid repository
// inputs for the parity gate, but must never be bundled into a Dashboard
// artifact. Scan generated text artifacts separately with exact audit markers
// so third-party chunks are not subjected to the broader product-name rules.
const auditManifest = JSON.parse(
  await readFile(resolve(root, "scripts/support-audit/capabilities.json"), "utf8"),
);
const internalAuditMarkers = [
  ["internal Support audit path", /scripts[\\/]support-audit/iu],
  ["internal Support route inventory", /reference-routes\.json/iu],
  ["internal Support route digest field", /canonical_route_sha256/iu],
  ["internal Support reference commit", new RegExp(escapePattern(String(auditManifest.reference.commit)), "u")],
  ["internal Support route digest", new RegExp(escapePattern(String(auditManifest.reference.canonical_route_sha256)), "u")],
];
for (const source of artifactSources) {
  const absolute = resolve(root, source);
  let info;
  try { info = await stat(absolute); } catch { continue; }
  const files = info.isDirectory() ? await walk(absolute) : [absolute];
  for (const file of files) {
    if (!extensions.has(extname(file))) continue;
    const content = await readFile(file, "utf8");
    for (const [label, pattern] of internalAuditMarkers) {
      if (pattern.test(content)) {
        failures.push(`${relative(root, file).replaceAll("\\", "/")}: ${label}`);
      }
    }
  }
}

if (failures.length) {
  console.error("SuperBoard Support publication leak gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("SuperBoard Support publication leak gate passed.");

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".dart_tool", ".next", ".open-next", "node_modules", "test", "tests", "__tests__"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
function ignored(file) {
  return /(?:^|\/)(?:test|tests|__tests__|runtime-tests|migrations)(?:\/|$)/u.test(file)
    || /(?:\.test|\.spec)\.[^.]+$/u.test(file)
    || /(?:generated-env|worker-configuration)\.d\.ts$/u.test(file);
}
function isPublishedSupportSurface(file) {
  return file.startsWith("workers/support/src/")
    || /^workers\/api\/src\/lib\/support-gateway(?:\.|\/)/u.test(file)
    || file.startsWith("apps/dashboard/src/api/support/")
    || file.startsWith("apps/dashboard/src/app/(protected)/support/")
    || file.startsWith("apps/dashboard/src/components/support/")
    || /^apps\/dashboard\/src\/components\/modules\/Support[^/]*\.(?:ts|tsx)$/u.test(file)
    || /^sdks\/javascript\/src\/support(?:\.|\/)/u.test(file)
    || /^sdks\/flutter\/lib\/(?:src\/support\/|superboard_support\.dart$)/u.test(file)
    || /^sdks\/flutterflow\/lib\/src\/support(?:\.|\/)/u.test(file)
    || /^packages\/contracts\/src\/support(?:-|\.)/u.test(file)
    || file.startsWith("packages/contracts/fixtures/support/");
}
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function requestedRoot(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--root" && args[1]) {
    return resolve(args[1]);
  }
  throw new Error("Usage: support-public-leak-check.mjs [--root <workspace>]");
}
