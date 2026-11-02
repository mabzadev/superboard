import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { samlHandler } from "../handlers";
import { authMiddleware, configMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiSamlIdps;
const samlRoutes = new Hono<typeConfig.Context>();
export default samlRoutes;

samlRoutes.get(
	`${BaseRoute}`,
	configMiddleware.enableSamlAsSp,
	authMiddleware.s2sRoot,
	samlHandler.getSamlIdps,
);

samlRoutes.get(
	`${BaseRoute}/:id`,
	configMiddleware.enableSamlAsSp,
	authMiddleware.s2sRoot,
	samlHandler.getSamlIdp,
);

samlRoutes.post(
	`${BaseRoute}`,
	configMiddleware.enableSamlAsSp,
	authMiddleware.s2sRoot,
	samlHandler.postIdp,
);

samlRoutes.put(
	`${BaseRoute}/:id`,
	configMiddleware.enableSamlAsSp,
	authMiddleware.s2sRoot,
	samlHandler.putIdp,
);

samlRoutes.delete(
	`${BaseRoute}/:id`,
	configMiddleware.enableSamlAsSp,
	authMiddleware.s2sRoot,
	samlHandler.deleteIdp,
);
