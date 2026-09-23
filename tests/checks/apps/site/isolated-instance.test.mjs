import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { stopOwnedProcesses } from "../../../fixtures/site-browser/owned-processes.mjs";

function start(source) {
	const child = spawn(process.execPath, ["-e", source], {
		detached: true,
		stdio: ["ignore", "pipe", "inherit"],
	});
	child.detachedGroup = true;
	return child;
}

await test("stops descendants after their group leader has already exited", async () => {
	const parent = start(
		'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(child.pid); process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>{},1000);',
	);
	const owned = new Map([["parent", parent]]);
	try {
		const [output] = await once(parent.stdout, "data");
		const descendant = Number(String(output).trim());
		assert.ok(descendant > 0);
		const exited = once(parent, "exit");
		parent.kill("SIGTERM");
		await exited;
		assert.doesNotThrow(() => process.kill(descendant, 0));
		await stopOwnedProcesses(owned);
		assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
	} finally {
		await stopOwnedProcesses(owned);
	}
});

await test("stopping one isolated group leaves another instance running", async () => {
	const first = start('console.log("ready"); setInterval(()=>{},1000);');
	const second = start('console.log("ready"); setInterval(()=>{},1000);');
	const firstOwned = new Map([["first", first]]);
	const secondOwned = new Map([["second", second]]);
	try {
		await Promise.all([once(first.stdout, "data"), once(second.stdout, "data")]);
		await stopOwnedProcesses(firstOwned);
		assert.doesNotThrow(() => process.kill(second.pid, 0));
		assert.throws(() => process.kill(first.pid, 0), { code: "ESRCH" });
	} finally {
		await stopOwnedProcesses(firstOwned);
		await stopOwnedProcesses(secondOwned);
	}
});
