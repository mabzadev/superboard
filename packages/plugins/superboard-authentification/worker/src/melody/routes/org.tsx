import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { orgHandler } from "../handlers";
import { authMiddleware, configMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiOrgs;
const orgRoutes = new Hono<typeConfig.Context>();
export default orgRoutes;

orgRoutes.get(
	`${BaseRoute}`,
	configMiddleware.enableOrg,
	authMiddleware.s2sReadOrg,
	orgHandler.getOrgs,
);

orgRoutes.get(
	`${BaseRoute}/:id`,
	configMiddleware.enableOrg,
	authMiddleware.s2sReadOrg,
	orgHandler.getOrg,
);

orgRoutes.post(
	`${BaseRoute}`,
	configMiddleware.enableOrg,
	authMiddleware.s2sWriteOrg,
	orgHandler.postOrg,
);

orgRoutes.put(
	`${BaseRoute}/:id`,
	configMiddleware.enableOrg,
	authMiddleware.s2sWriteOrg,
	orgHandler.putOrg,
);

orgRoutes.delete(
	`${BaseRoute}/:id`,
	configMiddleware.enableOrg,
	authMiddleware.s2sWriteOrg,
	orgHandler.deleteOrg,
);

orgRoutes.get(
	`${BaseRoute}/:id/users`,
	configMiddleware.enableOrg,
	authMiddleware.s2sReadOrg,
	authMiddleware.s2sReadUser,
	orgHandler.getOrgActiveUsers,
);

orgRoutes.get(
	`${BaseRoute}/:id/all-users`,
	configMiddleware.enableOrg,
	authMiddleware.s2sReadOrg,
	authMiddleware.s2sReadUser,
	orgHandler.getOrgAllUsers,
);
