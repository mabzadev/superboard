import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plug-products.command.create_product",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/products/projects/:projectRef/catalog/products",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.update_product",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/products/projects/:projectRef/catalog/products/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.archive_product",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/products/projects/:projectRef/catalog/products/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.create_package",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/products/projects/:projectRef/packages",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.update_package",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/products/projects/:projectRef/packages/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.archive_package",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/products/projects/:projectRef/packages/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.create_offering",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/products/projects/:projectRef/offerings",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.update_offering",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/products/projects/:projectRef/offerings/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.archive_offering",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/products/projects/:projectRef/offerings/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.create_entitlement",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/products/projects/:projectRef/entitlements",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.update_entitlement",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/products/projects/:projectRef/entitlements/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.archive_entitlement",
		kind: "command",
		operations: [
			{
				method: "DELETE",
				path: "/api/v1/products/projects/:projectRef/entitlements/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.command.sync_store_catalog",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/products/projects/:projectRef/catalog/sync",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.products",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/catalog/products",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.packages",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/packages",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.offerings",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/offerings",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.entitlements",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/entitlements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.product_statistics",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/statistics",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plug-products.data_source.store_sync_runs",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/products/projects/:projectRef/catalog/syncs",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
