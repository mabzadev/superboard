import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-gateway.command.publish_gateway_manifest",
		kind: "command",
		operations: [
			{
				route_id: "api:gateway:manifest-publish",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-gateway.command.update_gateway_route",
		kind: "command",
		operations: [
			{
				route_id: "api:gateway:route-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-gateway.command.rotate_access_policy",
		kind: "command",
		operations: [
			{
				route_id: "api:gateway:access-policy-update",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-gateway.data_source.active_gateway_manifest",
		kind: "data_source",
		operations: [
			{
				route_id: "api:gateway:manifest-active",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-gateway.data_source.gateway_routes",
		kind: "data_source",
		operations: [
			{
				route_id: "api:gateway:routes-list",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-gateway.data_source.rate_limits",
		kind: "data_source",
		operations: [
			{
				route_id: "api:gateway:rate-limits-list",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
