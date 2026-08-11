#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const nonNodeSecurityAuditContract = Object.freeze({
  python: Object.freeze({
    runtimeVersion: "3.13.7",
    tool: "pip-audit",
    toolVersion: "2.10.1",
    requirements:
      "workers/custom/vocostar/orchestrators/vocals/container/requirements.txt",
  }),
  ruby: Object.freeze({
    runtimeVersion: "3.4.9",
    bundlerVersion: "2.7.2",
    tool: "bundler-audit",
    toolVersion: "0.9.3",
    lockfile: "sdks/react-native/example/Gemfile.lock",
  }),
});

export function nonNodeSecurityAuditPlan(root = repositoryRoot) {
  const python = nonNodeSecurityAuditContract.python;
  const ruby = nonNodeSecurityAuditContract.ruby;
  return {
    versionChecks: [
      {
        command: "python3",
        args: ["-m", "pip_audit", "--version"],
        expected: `${python.tool} ${python.toolVersion}`,
      },
      {
        command: "bundle-audit",
        args: ["--version"],
        expected: `${ruby.tool} ${ruby.toolVersion}`,
      },
    ],
    audits: [
      {
        command: "python3",
        args: [
          "-m",
          "pip_audit",
          "--requirement",
          resolve(root, python.requirements),
          "--progress-spinner",
          "off",
          "--strict",
        ],
      },
      {
        command: "bundle-audit",
        args: ["check", "--update"],
        cwd: resolve(root, "sdks/react-native/example"),
      },
    ],
  };
}

export function runNonNodeSecurityAudit(execute = executeCommand) {
  const plan = nonNodeSecurityAuditPlan();
  for (const check of plan.versionChecks) {
    const observed = execute(check.command, check.args, {
      capture: true,
    }).trim();
    if (observed !== check.expected) {
      throw new Error(
        `${check.command} resolved ${observed || "<empty>"}; expected ${check.expected}`,
      );
    }
  }
  for (const audit of plan.audits) {
    execute(audit.command, audit.args, { cwd: audit.cwd });
  }
  return {
    status: "ok",
    audits: plan.audits.length,
    tools: {
      python: nonNodeSecurityAuditContract.python.toolVersion,
      ruby: nonNodeSecurityAuditContract.ruby.toolVersion,
    },
  };
}

function executeCommand(
  command,
  args,
  { capture = false, cwd = repositoryRoot } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: false,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = capture
      ? String(result.stderr || result.stdout || "").trim()
      : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return capture ? String(result.stdout || "") : "";
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = runNonNodeSecurityAudit();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
