import { defineCommand, runCommand } from "citty";

import { bundleCommand } from "./bundle.js";

export const pluginValidateCommand = defineCommand({
	meta: {
		name: "validate",
		description: "Validate a plugin without producing a tarball (same checks as bundle)",
	},
	args: {
		dir: {
			type: "string",
			description: "Plugin directory (default: current directory)",
			default: ".",
		},
	},
	async run({ args }) {
		await runCommand(bundleCommand, {
			rawArgs: ["--dir", args.dir, "--validateOnly"],
		});
	},
});
