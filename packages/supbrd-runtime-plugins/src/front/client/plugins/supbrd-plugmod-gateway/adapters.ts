import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-gateway.command.publish_gateway_manifest",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/gateway/manifests",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-gateway.command.update_gateway_route",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/gateway/routes/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-gateway.command.rotate_access_policy",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/gateway/access-policy",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-gateway.data_source.active_gateway_manifest",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/gateway/active-manifest",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-gateway.data_source.gateway_routes",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/gateway/routes",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-gateway.data_source.rate_limits",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/gateway/rate-limits",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
