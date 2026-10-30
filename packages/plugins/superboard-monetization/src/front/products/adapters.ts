import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-products.command.create_product",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:POST:/internal/v1/catalog/products",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.update_product",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:PUT:/internal/v1/catalog/products/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.archive_product",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:DELETE:/internal/v1/catalog/products/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.command.create_package",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:POST:/internal/v1/packages",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.update_package",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:PUT:/internal/v1/packages/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.archive_package",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:DELETE:/internal/v1/packages/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.command.create_offering",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:POST:/internal/v1/offerings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.update_offering",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:PUT:/internal/v1/offerings/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.archive_offering",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:DELETE:/internal/v1/offerings/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.command.create_entitlement",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:POST:/internal/v1/entitlements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.update_entitlement",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:PUT:/internal/v1/entitlements/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.command.archive_entitlement",
		kind: "command",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:DELETE:/internal/v1/entitlements/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.command.sync_store_catalog",
		kind: "command",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:POST:/internal/v1/catalog/sync",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-products.data_source.products",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:products:operator-proxy->products:index.app:GET:/internal/v1/catalog/products",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.data_source.packages",
		kind: "data_source",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:GET:/internal/v1/packages",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.data_source.offerings",
		kind: "data_source",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:GET:/internal/v1/offerings",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.data_source.entitlements",
		kind: "data_source",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:GET:/internal/v1/entitlements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.data_source.product_statistics",
		kind: "data_source",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:GET:/internal/v1/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-products.data_source.store_sync_runs",
		kind: "data_source",
		operations: [
			{
				route_id: "api:products:operator-proxy->products:index.app:GET:/internal/v1/catalog/syncs",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
