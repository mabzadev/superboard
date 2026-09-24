export const pluginId = "supbrd-plugmod-billing";
export const views = {
	"superboard.products_purchases": () => import("./views/superboard.products_purchases.js"),
	"superboard.monetization_purchases": () => import("./views/superboard.products_purchases.js"),
	"superboard.products_customers": () => import("./views/superboard.products_customers.js"),
	"superboard.products_entitlements": () => import("./views/superboard.products_entitlements.js"),
	"superboard.monetization_customers": () => import("./views/superboard.products_customers.js"),
	"superboard.monetization_entitlements": () =>
		import("./views/superboard.products_entitlements.js"),
};
