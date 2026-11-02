import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { appHandler } from "../handlers";
import { authMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiApps;
const appRoutes = new Hono<typeConfig.Context>();
export default appRoutes;

appRoutes.get(`${BaseRoute}`, authMiddleware.s2sReadApp, appHandler.getApps);

appRoutes.get(`${BaseRoute}/:id`, authMiddleware.s2sReadApp, appHandler.getApp);

appRoutes.post(`${BaseRoute}`, authMiddleware.s2sWriteApp, appHandler.postApp);

appRoutes.put(`${BaseRoute}/:id`, authMiddleware.s2sWriteApp, appHandler.putApp);

appRoutes.delete(`${BaseRoute}/:id`, authMiddleware.s2sWriteApp, appHandler.deleteApp);
