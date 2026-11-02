import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { userAttributeHandler } from "../handlers";
import { authMiddleware, configMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiUserAttributes;
const userAttributeRoutes = new Hono<typeConfig.Context>();
export default userAttributeRoutes;

userAttributeRoutes.get(
	`${BaseRoute}`,
	configMiddleware.enableUserAttribute,
	authMiddleware.s2sReadUserAttribute,
	userAttributeHandler.getUserAttributes,
);

userAttributeRoutes.post(
	`${BaseRoute}`,
	configMiddleware.enableUserAttribute,
	authMiddleware.s2sWriteUserAttribute,
	userAttributeHandler.createUserAttribute,
);

userAttributeRoutes.get(
	`${BaseRoute}/:id`,
	configMiddleware.enableUserAttribute,
	authMiddleware.s2sReadUserAttribute,
	userAttributeHandler.getUserAttribute,
);

userAttributeRoutes.put(
	`${BaseRoute}/:id`,
	configMiddleware.enableUserAttribute,
	authMiddleware.s2sWriteUserAttribute,
	userAttributeHandler.updateUserAttribute,
);

userAttributeRoutes.delete(
	`${BaseRoute}/:id`,
	configMiddleware.enableUserAttribute,
	authMiddleware.s2sWriteUserAttribute,
	userAttributeHandler.deleteUserAttribute,
);
