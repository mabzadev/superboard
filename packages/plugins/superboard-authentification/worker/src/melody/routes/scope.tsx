import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { scopeHandler } from "../handlers";
import { authMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiScopes;
const scopeRoutes = new Hono<typeConfig.Context>();
export default scopeRoutes;

scopeRoutes.get(`${BaseRoute}`, authMiddleware.s2sReadScope, scopeHandler.getScopes);

scopeRoutes.get(`${BaseRoute}/:id`, authMiddleware.s2sReadScope, scopeHandler.getScope);

scopeRoutes.post(`${BaseRoute}`, authMiddleware.s2sWriteScope, scopeHandler.postScope);

scopeRoutes.put(`${BaseRoute}/:id`, authMiddleware.s2sWriteScope, scopeHandler.putScope);

scopeRoutes.delete(`${BaseRoute}/:id`, authMiddleware.s2sWriteScope, scopeHandler.deleteScope);
