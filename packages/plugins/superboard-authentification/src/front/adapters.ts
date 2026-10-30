import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-user.command.update_profile",
		kind: "command",
		operations: [
			{
				route_id: "api:routes.application-users-admin.routes:PUT:/:projectRef/profiles/:userId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-user.command.suspend_member",
		kind: "command",
		operations: [
			{
				route_id:
					"api:routes.application-users-admin.routes:POST:/:projectRef/profiles/:userId/suspend",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-user.data_source.current_profile",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.application-users-admin.routes:GET:/:projectRef/profiles/:userId",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-user.data_source.members",
		kind: "data_source",
		operations: [
			{
				route_id: "api:routes.application-users-admin.routes:GET:/:projectRef/members",
				query: "passthrough",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
