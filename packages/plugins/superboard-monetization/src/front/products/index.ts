export const pluginId = "supbrd-plug-products";
export const views = {
	"superboard.products": () => import("./views/superboard.products.js"),
	"superboard.products_products": () => import("./views/superboard.products_products.js"),
	"superboard.products_offerings": () => import("./views/superboard.products_offerings.js"),
	"superboard.monetization_products": () => import("./views/superboard.products.js"),
	"superboard.monetization_offerings": () => import("./views/superboard.products_offerings.js"),
	"superboard.monetization_products_products": () =>
		import("./views/superboard.products_products.js"),
	"superboard.monetization_settings": () => import("../views/superboard.monetization_settings.js"),
};
