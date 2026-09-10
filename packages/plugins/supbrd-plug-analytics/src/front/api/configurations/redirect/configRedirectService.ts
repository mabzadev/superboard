import type { AxiosResponse } from "axios";

import { config } from "../../../../../../../supbrd-front-ui/src/shared/lib/config.js";
import type { RedirectConfig } from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import { GET, PUT } from "../../../transport.js";

interface RedirectConfigResponse {
	redirect_config: RedirectConfig;
}

export const getProjectRedirectsAPICall = async (
	projectId: string,
): Promise<AxiosResponse<RedirectConfigResponse>> => {
	return GET(config.apiPath + `/projects/${projectId}/redirect_config`);
};

export const setRedirectAPICall = async (
	projectId: string,
	platform: string,
	variation: string,
	appstore: boolean,
	fallback_url: string | null,
	enabled: boolean,
): Promise<AxiosResponse<RedirectConfigResponse>> => {
	const data = {
		platform: platform,
		variation: variation,
		appstore: appstore,
		fallback_url: fallback_url,
		enabled: enabled,
	};

	return PUT(config.apiPath + `/projects/${projectId}/redirect_config/redirect`, data);
};

export const setDefaultRedirectAPICall = async (
	projectId: string,
	default_fallback: string,
	showAndroidPreview: boolean,
	showIosPreview: boolean,
): Promise<AxiosResponse<RedirectConfigResponse>> => {
	const data = {
		default_fallback: default_fallback,
		show_preview_android: showAndroidPreview,
		show_preview_ios: showIosPreview,
	};

	return PUT(config.apiPath + `/projects/${projectId}/redirect_config`, data);
};
