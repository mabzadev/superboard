import { spawnSync } from "node:child_process";
import { once } from "node:events";

export async function stopOwnedProcesses(children) {
	const members = (child) => {
		const processes = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf8" });
		if (processes.status !== 0) throw new Error("Unable to verify owned process shutdown");
		return processes.stdout.split("\n").flatMap((line) => {
			const [pid, group, status] = line.trim().split(/\s+/u);
			return (child.detachedGroup ? Number(group) === child.pid : Number(pid) === child.pid) &&
				status &&
				!status.startsWith("Z")
				? [Number(pid)]
				: [];
		});
	};
	await Promise.all(
		Array.from(children.values(), async (child) => {
			if (!child.detachedGroup && (child.exitCode !== null || child.signalCode !== null)) return;
			const exited =
				child.exitCode === null && child.signalCode === null
					? once(child, "exit")
					: Promise.resolve();
			const signal = (name) => {
				for (const pid of members(child)) {
					try {
						process.kill(pid, name);
					} catch (error) {
						if (error.code !== "ESRCH")
							throw new Error(`Cannot ${name} owned process ${pid}: ${error.message}`);
					}
				}
			};
			signal("SIGCONT");
			signal("SIGTERM");
			const deadline = Date.now() + 10000;
			while (members(child).length && Date.now() < deadline)
				await new Promise((done) => {
					setTimeout(done, 100);
				});
			if (members(child).length) signal("SIGKILL");
			const killDeadline = Date.now() + 5000;
			while (members(child).length && Date.now() < killDeadline)
				await new Promise((done) => {
					setTimeout(done, 100);
				});
			if (members(child).length) throw new Error(`Owned process group still running: ${child.pid}`);
			await exited;
		}),
	);
}
