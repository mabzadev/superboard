import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";

import { typeConfig } from "../configs";
import { otherHandler } from "../handlers";
import { authMiddleware } from "../middlewares";
import embeddedSwaggerSpec from "../scripts/embedded-swagger.json";
import s2sSwaggerSpec from "../scripts/swagger.json";

const otherRoutes = new Hono<typeConfig.Context>();
export default otherRoutes;

otherRoutes.get("/info", authMiddleware.s2s, otherHandler.getSystemInfo);

otherRoutes.get("/.well-known/openid-configuration", otherHandler.getOpenidConfig);

otherRoutes.get("/.well-known/jwks.json", otherHandler.getJwks);

otherRoutes.get(
	"/api/v1/swagger",
	swaggerUI({
		spec: s2sSwaggerSpec,
		url: "/",
	}),
);

otherRoutes.get(
	"/api/v1/embedded-swagger",
	swaggerUI({
		spec: embeddedSwaggerSpec,
		url: "/",
	}),
);
