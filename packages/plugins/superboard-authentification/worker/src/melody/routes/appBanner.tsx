import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { appBannerHandler } from "../handlers";
import { authMiddleware, configMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiAppBanners;
const appBannerRoutes = new Hono<typeConfig.Context>();
export default appBannerRoutes;

appBannerRoutes.get(
	`${BaseRoute}`,
	configMiddleware.enableAppBanner,
	authMiddleware.s2sReadApp,
	appBannerHandler.getAppBanners,
);

appBannerRoutes.post(
	`${BaseRoute}`,
	configMiddleware.enableAppBanner,
	authMiddleware.s2sWriteApp,
	appBannerHandler.postAppBanner,
);

appBannerRoutes.get(
	`${BaseRoute}/:id`,
	configMiddleware.enableAppBanner,
	authMiddleware.s2sReadApp,
	appBannerHandler.getAppBanner,
);

appBannerRoutes.put(
	`${BaseRoute}/:id`,
	configMiddleware.enableAppBanner,
	authMiddleware.s2sWriteApp,
	appBannerHandler.putAppBanner,
);

appBannerRoutes.delete(
	`${BaseRoute}/:id`,
	configMiddleware.enableAppBanner,
	authMiddleware.s2sWriteApp,
	appBannerHandler.deleteAppBanner,
);
