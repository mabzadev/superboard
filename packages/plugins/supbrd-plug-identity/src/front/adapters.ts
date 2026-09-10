import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plug-user.command.update_profile",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/application-users/projects/:projectRef/profiles/:userId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-user.command.suspend_member",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/application-users/projects/:projectRef/profiles/:userId/suspend",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-user.data_source.current_profile",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/application-users/projects/:projectRef/profiles/:userId",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-user.data_source.members",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/application-users/projects/:projectRef/members",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
