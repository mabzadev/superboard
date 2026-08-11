#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const upstreamBackend = "upstream/opengrow/backend";
const workerRoot = "workers/api";

const read = (file) => readFileSync(path.join(root, file), "utf8");
const listFiles = (dir, suffix) => {
  const base = path.join(root, dir);
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!suffix || full.endsWith(suffix)) out.push(full);
    }
  };
  walk(base);
  return out.sort();
};

const rel = (file) => path.relative(root, file);

function gitRev(dir) {
  if (!existsSync(path.join(root, dir))) return null;
  try {
    return execFileSync("git", ["-C", path.join(root, dir), "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function parseRailsRoutes() {
  const file = `${upstreamBackend}/config/routes.rb`;
  if (!existsSync(path.join(root, file))) return [];
  const lines = read(file).split(/\r?\n/);
  const routes = [];
  const blocks = [];

  const currentPrefix = () => blocks.map((block) => block.prefix).filter(Boolean).join("/");
  const joinPath = (prefix, routePath) => {
    const path = String(routePath || "").replace(/^\/+|\/+$/g, "");
    return `/${[prefix, path].filter(Boolean).join("/")}`.replace(/\/+/g, "/");
  };

  lines.forEach((line, index) => {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (line.trim() === "end") {
      blocks.pop();
      return;
    }

    const match = line.match(/^\s*(get|post|put|patch|delete)\s+["']([^"']+)["'](.*)$/);
    if (match) {
      const tail = match[3];
      const to = tail.match(/to:\s*["']([^"']+)["']/)?.[1] ?? null;
      const action = tail.match(/action:\s*:?(["']?)([a-zA-Z_]+)\1/)?.[2] ?? null;

      routes.push({
        method: match[1].toUpperCase(),
        path: joinPath(currentPrefix(), match[2]),
        rawPath: match[2],
        target: to ?? action ?? null,
        file,
        line: index + 1,
      });
      return;
    }

    if (/^\s*if\b/.test(line)) {
      blocks.push({ indent, prefix: "" });
      return;
    }

    if (!line.includes(" do")) return;

    const namespace = line.match(/^\s*namespace\s+:([a-zA-Z0-9_]+)/)?.[1];
    const scope = line.match(/^\s*scope\s+:([a-zA-Z0-9_]+)/)?.[1];
    blocks.push({ indent, prefix: namespace || scope || "" });
  });

  return routes;
}

function normalizedRouteKey(route) {
  const path = route.path === "/" ? "/" : String(route.path).replace(/\/+$/, "");
  return `${route.method} ${path}`
    .replace(/\/:(?:[a-zA-Z_][a-zA-Z0-9_]*)/g, "/:param")
    .replace(/\/\*:?[a-zA-Z_][a-zA-Z0-9_]*/g, "/*")
    .replace(/\/+/g, "/");
}

function parseWorkerRoutes() {
  const indexPath = `${workerRoot}/src/index.ts`;
  const index = read(indexPath);
  const mounts = new Map();
  const imports = new Map();
  for (const match of index.matchAll(/import\s+([a-zA-Z0-9_]+)\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g)) {
    imports.set(`${workerRoot}/src/routes/${match[2]}.ts`, match[1]);
  }
  for (const match of index.matchAll(/app\.route\(["']([^"']*)["'],\s*([a-zA-Z0-9_]+)Routes\)/g)) {
    mounts.set(match[2], match[1]);
  }

  const routes = [];
  index.split(/\r?\n/).forEach((line, indexLine) => {
    const match = line.match(/^\s*app\.(get|post|put|patch|delete)\(["']([^"']+)["']/);
    if (!match) return;
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      localPath: match[2],
      mount: "",
      file: indexPath,
      line: indexLine + 1,
    });
  });

  for (const file of listFiles(`${workerRoot}/src/routes`, ".ts").filter((file) => !file.endsWith(".test.ts"))) {
    const source = read(rel(file));
    const varName = source.match(/const\s+([a-zA-Z0-9_]+)\s*=\s*new Hono/)?.[1];
    const importName = imports.get(rel(file));
    const mount = mounts.get(varName) ?? mounts.get(importName?.replace(/Routes$/, "")) ?? "";
    const lines = source.split(/\r?\n/);

    const routePattern = varName
      ? new RegExp(`^\\s*${varName}\\.(get|post|put|patch|delete)\\(["']([^"']+)["']`)
      : null;

    lines.forEach((line, index) => {
      const match = routePattern ? line.match(routePattern) : null;
      if (!match) return;
      routes.push({
        method: match[1].toUpperCase(),
        path: `${mount}${match[2]}`.replace(/\/+/g, "/"),
        localPath: match[2],
        mount,
        file: rel(file),
        line: index + 1,
      });
    });
  }

  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function parseRailsTables() {
  const file = `${upstreamBackend}/db/schema.rb`;
  if (!existsSync(path.join(root, file))) return {};
  const lines = read(file).split(/\r?\n/);
  const tables = {};
  let current = null;

  for (const line of lines) {
    const table = line.match(/create_table\s+"([^"]+)"/)?.[1];
    if (table) {
      current = table;
      tables[current] = { columns: [], indexes: 0 };
      continue;
    }
    if (current && line.match(/^\s*end\s*$/)) {
      current = null;
      continue;
    }
    if (!current) continue;

    const column = line.match(/^\s*t\.[a-z_]+\s+"([^"]+)"/)?.[1];
    if (column) tables[current].columns.push(column);
    if (line.includes("t.index")) tables[current].indexes += 1;
  }

  return tables;
}

function parseD1Tables() {
  const tables = {};
  for (const file of listFiles(`${workerRoot}/migrations`, ".sql")) {
    const lines = read(rel(file)).split(/\r?\n/);
    let current = null;

    for (const line of lines) {
      const drop = line.match(/DROP TABLE(?: IF EXISTS)?\s+([a-zA-Z0-9_]+)/i)?.[1];
      if (drop) {
        delete tables[drop];
        if (current === drop) current = null;
        continue;
      }

      const rename = line.match(/ALTER TABLE\s+([a-zA-Z0-9_]+)\s+RENAME TO\s+([a-zA-Z0-9_]+)/i);
      if (rename) {
        if (tables[rename[1]]) {
          tables[rename[2]] = tables[rename[1]];
          tables[rename[2]].files.add(rel(file));
          delete tables[rename[1]];
        }
        continue;
      }

      const create = line.match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(/i)?.[1];
      if (create) {
        current = create;
        tables[current] ??= { columns: [], files: new Set() };
        tables[current].files.add(rel(file));
        continue;
      }
      if (current && line.match(/^\s*\);/)) {
        current = null;
        continue;
      }
      if (current) {
        const trimmed = line.trim();
        const column = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/)?.[1];
        if (column && !["FOREIGN", "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT"].includes(column.toUpperCase())) {
          if (!tables[current].columns.includes(column)) tables[current].columns.push(column);
        }
      }

      const alter = line.match(/ALTER TABLE\s+([a-zA-Z0-9_]+)\s+ADD COLUMN\s+([a-zA-Z0-9_]+)/i);
      if (alter) {
        tables[alter[1]] ??= { columns: [], files: new Set() };
        tables[alter[1]].files.add(rel(file));
        if (!tables[alter[1]].columns.includes(alter[2])) tables[alter[1]].columns.push(alter[2]);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(tables).map(([name, value]) => [
      name,
      { columns: value.columns.sort(), files: [...value.files].sort() },
    ])
  );
}

function listUpstream(kind) {
  return listFiles(`${upstreamBackend}/app/${kind}`, ".rb")
    .map((file) => rel(file).replace(`${upstreamBackend}/app/${kind}/`, ""))
    .sort();
}

function markerRoutes() {
  const markers = [];
  const placeholderPattern =
    /not available|not implemented|emptyMetrics|emptyConfig\(|metrics:\s*\{\s*\}|return c\.json\(\{\s*(tokens|visitors|data|notifications):\s*\[\]|message:\s*['"]ok['"]/i;

  for (const file of listFiles(`${workerRoot}/src/routes`, ".ts").filter((file) => !file.endsWith(".test.ts"))) {
    const lines = read(rel(file)).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (placeholderPattern.test(line)) {
        markers.push({ file: rel(file), line: index + 1, text: line.trim() });
      }
    });
  }
  return markers;
}

const railsRoutes = parseRailsRoutes();
const workerRoutes = parseWorkerRoutes();
const upstreamAvailable = existsSync(path.join(root, upstreamBackend));
const workerRouteKeys = new Set(workerRoutes.map(normalizedRouteKey));
const railsRouteKeys = new Set(railsRoutes.map(normalizedRouteKey));
const railsTables = parseRailsTables();
const d1Tables = parseD1Tables();
const railsTableNames = Object.keys(railsTables).sort();
const d1TableNames = Object.keys(d1Tables).sort();

const inventory = {
  generatedAt: new Date().toISOString(),
  upstreamAvailable,
  upstream: {
    backend: gitRev("upstream/opengrow/backend"),
    dashboard: gitRev("upstream/opengrow/dashboard"),
    mcp: gitRev("upstream/opengrow/mcp"),
    opengrowJs: gitRev("upstream/opengrow/opengrow-js"),
    ios: gitRev("upstream/opengrow/opengrow-iOS"),
    android: gitRev("upstream/opengrow/opengrow-Android"),
    reactNative: gitRev("upstream/opengrow/opengrow-react-native"),
    flutter: gitRev("upstream/opengrow/opengrow-flutter"),
    utils: gitRev("upstream/opengrow/opengrow-utils"),
  },
  counts: {
    upstreamRoutes: upstreamAvailable ? railsRoutes.length : null,
    workerRoutes: workerRoutes.length,
    upstreamTables: upstreamAvailable ? railsTableNames.length : null,
    d1Tables: d1TableNames.length,
    upstreamJobs: upstreamAvailable ? listUpstream("jobs").length : null,
    upstreamServices: upstreamAvailable ? listUpstream("services").length : null,
    upstreamModels: upstreamAvailable ? listUpstream("models").length : null,
    upstreamSerializers: upstreamAvailable ? listUpstream("serializers").length : null,
  },
  verification: {
    status: upstreamAvailable ? "verified-against-upstream" : "upstream-unavailable",
    verified: upstreamAvailable,
    source: upstreamBackend,
    detail: upstreamAvailable
      ? "Route and schema comparisons were computed from the checked-out upstream source."
      : "Only the local Worker and D1 inventories were computed; upstream parity was not evaluated.",
  },
  routes: {
    upstream: railsRoutes,
    worker: workerRoutes,
    missingFromWorker: upstreamAvailable
      ? railsRoutes.filter((route) => !workerRouteKeys.has(normalizedRouteKey(route)))
      : null,
    extraInWorker: upstreamAvailable
      ? workerRoutes.filter((route) => !railsRouteKeys.has(normalizedRouteKey(route)))
      : null,
  },
  schema: {
    missingTables: upstreamAvailable
      ? railsTableNames.filter((name) => !d1TableNames.includes(name))
      : null,
    extraTables: upstreamAvailable
      ? d1TableNames.filter((name) => !railsTableNames.includes(name))
      : null,
    tables: Object.fromEntries(
      railsTableNames.map((name) => [
        name,
        {
          upstreamColumns: railsTables[name].columns.sort(),
          d1Columns: (d1Tables[name]?.columns ?? []).sort(),
          missingColumns: railsTables[name].columns
            .filter((column) => !(d1Tables[name]?.columns ?? []).includes(column))
            .sort(),
        },
      ])
    ),
  },
  upstreamFiles: {
    jobs: listUpstream("jobs"),
    services: listUpstream("services"),
    models: listUpstream("models"),
    serializers: listUpstream("serializers"),
  },
  implementationMarkers: markerRoutes(),
};

if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({
    generatedAt: inventory.generatedAt,
    upstreamAvailable: inventory.upstreamAvailable,
    verification: inventory.verification,
    upstream: inventory.upstream,
    counts: inventory.counts,
    missingRoutes: inventory.routes.missingFromWorker,
    extraWorkerRoutes: inventory.routes.extraInWorker,
    missingTables: inventory.schema.missingTables,
    extraTables: inventory.schema.extraTables,
    tablesWithMissingColumns: upstreamAvailable
      ? Object.entries(inventory.schema.tables)
        .filter(([, table]) => table.missingColumns.length > 0)
        .map(([name, table]) => ({ name, missingColumns: table.missingColumns }))
      : null,
    implementationMarkers: inventory.implementationMarkers,
  }, null, 2));
} else {
  console.log(JSON.stringify(inventory, null, 2));
}

if (process.argv.includes("--require-upstream") && !upstreamAvailable) {
  console.error(
    `Upstream parity cannot be verified because ${upstreamBackend} is not available.`,
  );
  process.exitCode = 2;
}
