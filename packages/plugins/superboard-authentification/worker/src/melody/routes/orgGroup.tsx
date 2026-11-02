import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { orgGroupHandler } from "../handlers";
import { authMiddleware, configMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiOrgGroups;
const orgGroupRoutes = new Hono<typeConfig.Context>();
export default orgGroupRoutes;

orgGroupRoutes.get(
	BaseRoute,
	configMiddleware.enableOrgGroup,
	authMiddleware.s2sReadOrg,
	orgGroupHandler.getOrgGroups,
);

orgGroupRoutes.post(
	BaseRoute,
	configMiddleware.enableOrgGroup,
	authMiddleware.s2sWriteOrg,
	orgGroupHandler.postOrgGroup,
);

orgGroupRoutes.get(
	`${BaseRoute}/:id/users`,
	configMiddleware.enableOrgGroup,
	authMiddleware.s2sReadUser,
	authMiddleware.s2sReadOrg,
	orgGroupHandler.getUsersByOrgGroupId,
);

orgGroupRoutes.put(
	`${BaseRoute}/:id`,
	configMiddleware.enableOrgGroup,
	authMiddleware.s2sWriteOrg,
	orgGroupHandler.putOrgGroup,
);

orgGroupRoutes.delete(
	`${BaseRoute}/:id`,
	configMiddleware.enableOrgGroup,
	authMiddleware.s2sWriteOrg,
	orgGroupHandler.deleteOrgGroup,
);
