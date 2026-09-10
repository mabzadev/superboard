import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "supbrd-plugmod-billing.command.migrate_products",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/billing/projects/:projectRef/ledger/migrate-products",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.migration_status",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/migration/status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.command.create_purchase",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/billing/projects/:projectRef/ledger/purchases",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.command.create_refund",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId/refunds",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.command.update_refund",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/billing/projects/:projectRef/ledger/refunds/:refundId",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.command.update_subscription",
		kind: "command",
		operations: [
			{
				method: "PUT",
				path: "/api/v1/billing/projects/:projectRef/ledger/subscriptions/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.command.reconcile_store",
		kind: "command",
		operations: [
			{
				method: "POST",
				path: "/api/v1/billing/projects/:projectRef/ledger/reconcile",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.purchases",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/purchases",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.purchase",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.refunds",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/refunds",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.subscriptions",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/subscriptions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.financial_customer_entitlements",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger/customers/:customerId/entitlements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "supbrd-plugmod-billing.data_source.billing_ledger",
		kind: "data_source",
		operations: [
			{
				method: "GET",
				path: "/api/v1/billing/projects/:projectRef/ledger",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
