import { execFileSync } from "node:child_process";

const mode = process.argv[2];

const run = (args) => execFileSync("pnpm", args, { stdio: "inherit" });

run(["install", "--no-frozen-lockfile"]);

if (mode === "version") {
	run(["changeset", "version"]);
	run(["install", "--no-frozen-lockfile"]);
} else if (mode === "publish") {
	run(["changeset", "publish"]);
} else {
	throw new Error(
		`Unknown release mode: ${JSON.stringify(mode)} (expected "version" or "publish")`,
	);
}
