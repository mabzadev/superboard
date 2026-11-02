import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { roleHandler } from "../handlers";
import { authMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiRoles;
const roleRoutes = new Hono<typeConfig.Context>();
export default roleRoutes;

roleRoutes.get(`${BaseRoute}`, authMiddleware.s2sReadRole, roleHandler.getRoles);

roleRoutes.get(`${BaseRoute}/:id`, authMiddleware.s2sReadRole, roleHandler.getRole);

roleRoutes.post(`${BaseRoute}`, authMiddleware.s2sWriteRole, roleHandler.postRole);

roleRoutes.put(`${BaseRoute}/:id`, authMiddleware.s2sWriteRole, roleHandler.putRole);

roleRoutes.delete(`${BaseRoute}/:id`, authMiddleware.s2sWriteRole, roleHandler.deleteRole);

roleRoutes.get(
	`${BaseRoute}/:id/users`,
	authMiddleware.s2sReadUser,
	authMiddleware.s2sReadRole,
	roleHandler.getUsersByRoleId,
);
