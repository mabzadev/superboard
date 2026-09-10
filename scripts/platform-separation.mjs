import { readdirSync } from "node:fs";
import { join } from "node:path";

const ignored = new Set([
	".git",
	"node_modules",
	"dist",
	"coverage",
	".wrangler",
	".astro",
	".agents",
	".claude",
]);

export function lintPlatformSeparation(root) {
	const diagnostics = [];
	function visit(directory) {
		for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
			if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
			const filename = directory ? `${directory}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				visit(filename);
				continue;
			}
			const application =
				/^(?:workers\/custom|plugins|tools\/flutterflow-applications)\/vocostar\//u.test(
					filename,
				) ||
				filename === "deploy/targets/vocostar.json" ||
				/^packages\/supbrd-runtime-plugins\/src\/(?:plugins|front)\/(?:client\/)?vocostar(?:[./])/u.test(
					filename,
				);
			const container =
				/(?:^|\/)(?:Dockerfile(?:\.[^/]+)?|(?:docker-)?compose\.ya?ml|\.dockerignore)$/iu.test(
					filename,
				) || /(?:^|\/)\.devcontainer\//u.test(filename);
			if (application || container)
				diagnostics.push({
					filename,
					severity: "error",
					code: "superboard(platform-separation)",
					message: application
						? "Application code belongs in its separate workspace."
						: "Container packaging is excluded from the SuperBoard platform.",
				});
		}
	}
	visit("");
	return diagnostics;
}
