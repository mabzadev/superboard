import { defineCommand } from "citty";

import { bundleCommand } from "./bundle.js";
import { pluginInitCommand } from "./plugin-init.js";
import { pluginValidateCommand } from "./plugin-validate.js";
import { publishCommand, marketplaceLoginCommand, marketplaceLogoutCommand } from "./publish.js";

export const pluginCommand = defineCommand({
	meta: { name: "plugin", description: "Manage plugins" },
	subCommands: {
		init: pluginInitCommand,
		bundle: bundleCommand,
		validate: pluginValidateCommand,
		publish: publishCommand,
		login: marketplaceLoginCommand,
		logout: marketplaceLogoutCommand,
	},
});
