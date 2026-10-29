import type { PluginApiAdapter } from "@superboard/front-ui/api";

export const adapters = [
	{
		id: "superboard-billing.command.migrate_products",
		kind: "command",
		operations: [
			{
				route_id: "api:billing:migrate-products",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.data_source.migration_status",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/migration/status",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.command.create_purchase",
		kind: "command",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:POST:/internal/v1/catalog-ledger/purchases",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.command.create_refund",
		kind: "command",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:POST:/internal/v1/catalog-ledger/purchases/:id/refunds",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.command.update_refund",
		kind: "command",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:PUT:/internal/v1/catalog-ledger/refunds/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.command.update_subscription",
		kind: "command",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:PUT:/internal/v1/catalog-ledger/subscriptions/:id",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.command.reconcile_store",
		kind: "command",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:POST:/internal/v1/catalog-ledger/reconcile",
				query: "none",
				body: "passthrough",
			},
		],
	},
	{
		id: "superboard-billing.data_source.purchases",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/purchases",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.data_source.purchase",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/purchases/:id",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.data_source.refunds",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/refunds",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.data_source.subscriptions",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/subscriptions",
				query: "passthrough",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.data_source.financial_customer_entitlements",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger/customers/:customerId/entitlements",
				query: "none",
				body: "none",
			},
		],
	},
	{
		id: "superboard-billing.data_source.billing_ledger",
		kind: "data_source",
		operations: [
			{
				route_id:
					"api:billing:ledger-proxy->billing:catalog-ledger.app:GET:/internal/v1/catalog-ledger",
				query: "none",
				body: "none",
			},
		],
	},
] satisfies readonly PluginApiAdapter[];
