import type { PluginStorageConfig } from "emdash";

export type FormsStorage = PluginStorageConfig & {
	forms: {
		indexes: ["status", "createdAt"];
		uniqueIndexes: ["slug"];
	};
	submissions: {
		indexes: [
			"formId",
			"status",
			"starred",
			"createdAt",
			["formId", "createdAt"],
			["formId", "status"],
		];
	};
};

export const FORMS_STORAGE_CONFIG = {
	forms: {
		indexes: ["status", "createdAt"] as const,
		uniqueIndexes: ["slug"] as const,
	},
	submissions: {
		indexes: [
			"formId",
			"status",
			"starred",
			"createdAt",
			["formId", "createdAt"],
			["formId", "status"],
		] as const,
	},
} satisfies PluginStorageConfig;
