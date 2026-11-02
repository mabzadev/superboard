import { isAbsolute, relative, resolve, sep } from "node:path";

import { defineCommand } from "citty";
import consola from "consola";
import pc from "picocolors";

import { BuildError, buildPlugin, type BuildLogger } from "../build/api.js";

const DEBOUNCE_MS = 150;
const WATCH_GLOBS = ["src/**", "emdash-plugin.jsonc", "package.json"];

export const devCommand = defineCommand({
	meta: {
		name: "dev",
		description: "Watch a sandboxed plugin's sources and rebuild on change",
	},
	args: {
		dir: {
			type: "string",
			description: "Plugin directory (default: current directory)",
			default: process.cwd(),
		},
		"out-dir": {
			type: "string",
			alias: "o",
			description: "Output directory (default: ./dist)",
			default: "dist",
		},
	},
	async run({ args }) {
		const { default: chokidar } = await import("chokidar");

		let shutdownStarted = false;

		const logger: BuildLogger = {
			start: (m) => consola.start(m),
			info: (m) => consola.info(m),
			success: (m) => consola.success(m),
			warn: (m) => consola.warn(m),
		};

		let pending: Promise<void> | undefined;
		let queuedTrigger: string | undefined;

		const runBuild = async (label: string): Promise<void> => {
			const stamp = new Date().toLocaleTimeString();
			console.log();
			console.log(pc.dim(`── ${label} at ${stamp} ─────────────────────`));
			try {
				await buildPlugin({
					dir: args.dir,
					outDir: args["out-dir"],
					logger,
				});
			} catch (error) {
				if (error instanceof BuildError) {
					consola.error(`${pc.bold(error.code)}: ${error.message}`);
				} else {
					consola.error(error instanceof Error ? error.message : String(error));
				}
				consola.info(
					pc.dim("Last successful build (if any) is still in dist/. Waiting for changes..."),
				);
			}
		};

		const startBuild = (label: string): void => {
			if (pending) {
				queuedTrigger = label;
				return;
			}
			pending = (async () => {
				try {
					let currentLabel = label;
					while (currentLabel) {
						await runBuild(currentLabel);
						currentLabel = queuedTrigger ?? "";
						queuedTrigger = undefined;
					}
				} finally {
					pending = undefined;
					queuedTrigger = undefined;
				}
			})();
		};

		await runBuild("initial build");

		const resolvedOutDir = resolve(args.dir, args["out-dir"]);
		const cwdAbs = resolve(args.dir);
		const outDirRel = relative(cwdAbs, resolvedOutDir);
		const outDirGlob =
			outDirRel && !outDirRel.startsWith("..") && !isAbsolute(outDirRel)
				? `${outDirRel.split(sep).join("/")}/**`
				: undefined;

		const ignored = ["**/node_modules/**", ...(outDirGlob ? [outDirGlob] : [])];

		const watcher = chokidar.watch(WATCH_GLOBS, {
			cwd: args.dir,
			ignoreInitial: true,
			ignored,
		});

		let timer: NodeJS.Timeout | undefined;
		let pendingTrigger: string | undefined;

		const scheduleRebuild = (path: string) => {
			if (shutdownStarted) return;
			pendingTrigger = path;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				const trigger = pendingTrigger ?? "change";
				pendingTrigger = undefined;
				timer = undefined;
				startBuild(`rebuild (${trigger})`);
			}, DEBOUNCE_MS);
		};

		watcher.on("add", scheduleRebuild);
		watcher.on("change", scheduleRebuild);
		watcher.on("unlink", scheduleRebuild);
		watcher.on("error", (error) => {
			consola.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`);
		});

		consola.info(`Watching ${pc.cyan(args.dir)} for changes (Ctrl-C to stop)`);

		await new Promise<void>((resolveOuter) => {
			const shutdown = () => {
				if (shutdownStarted) {
					consola.warn("Second interrupt — forcing exit.");
					process.exit(130);
				}
				shutdownStarted = true;
				consola.info("Stopping watcher (waiting for in-flight build)...");
				if (timer) clearTimeout(timer);
				queuedTrigger = undefined;
				const drainAndClose = async () => {
					await watcher.close();
					if (pending) {
						try {
							await pending;
						} catch {}
					}
					process.off("SIGINT", shutdown);
					process.off("SIGTERM", shutdown);
					resolveOuter();
				};
				void drainAndClose();
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		});
	},
});
