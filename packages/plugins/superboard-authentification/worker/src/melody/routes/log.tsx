import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { logHandler } from "../handlers";
import { authMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiLogs;
const logRoutes = new Hono<typeConfig.Context>();
export default logRoutes;

logRoutes.get(`${BaseRoute}/email`, authMiddleware.s2sRoot, logHandler.getEmailLogs);

logRoutes.delete(`${BaseRoute}/email`, authMiddleware.s2sRoot, logHandler.deleteEmailLogs);

logRoutes.get(`${BaseRoute}/email/:id`, authMiddleware.s2sRoot, logHandler.getEmailLog);

logRoutes.get(`${BaseRoute}/sms`, authMiddleware.s2sRoot, logHandler.getSmsLogs);

logRoutes.delete(`${BaseRoute}/sms`, authMiddleware.s2sRoot, logHandler.deleteSmsLogs);

logRoutes.get(`${BaseRoute}/sms/:id`, authMiddleware.s2sRoot, logHandler.getSmsLog);

logRoutes.get(`${BaseRoute}/sign-in`, authMiddleware.s2sRoot, logHandler.getSignInLogs);

logRoutes.delete(`${BaseRoute}/sign-in`, authMiddleware.s2sRoot, logHandler.deleteSignInLogs);

logRoutes.get(`${BaseRoute}/sign-in/:id`, authMiddleware.s2sRoot, logHandler.getSignInLog);
