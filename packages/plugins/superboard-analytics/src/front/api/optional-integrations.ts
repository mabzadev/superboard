import { createPluginApiClient } from "@superboard/front-ui/api";

export const userApi = createPluginApiClient("superboard-user");
export const productsApi = createPluginApiClient("superboard-products");
export const dynamicLinksApi = createPluginApiClient("superboard-dynamic-links");
