import { createPluginApiClient } from "@superboard/front-ui/api";

export const userApi = createPluginApiClient("supbrd-plug-user");
export const productsApi = createPluginApiClient("supbrd-plug-products");
export const dynamicLinksApi = createPluginApiClient("supbrd-plugmod-dynamic-links");
