import { createPluginApiClient } from "@superboard/front-ui/api";

import { adapters } from "./adapters.js";

export const { GET, POST, PUT, PATCH, DELETE, request } = createPluginApiClient(
	"supbrd-plugmod-gateway",
	adapters,
);
export type { RequestOptions } from "@superboard/front-ui/api";
