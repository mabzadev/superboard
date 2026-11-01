import { config } from "@superboard/front-ui/lib/config.js";
import type { AxiosResponse } from "axios";

import { POST } from "../../transport.js";

export interface McpApproveConsentParams {
	client_id: string;
	redirect_uri: string;
	code_challenge?: string;
	code_challenge_method?: string;
	state?: string;
	scope?: string;
}

export interface McpApproveConsentResponse {
	code: string;
	redirect_uri: string;
	state?: string;
}

export const approveConsentAPICall = async (
	params: McpApproveConsentParams,
): Promise<AxiosResponse<McpApproveConsentResponse>> => {
	return POST(config.apiPath + "/mcp/approve_consent", params);
};
