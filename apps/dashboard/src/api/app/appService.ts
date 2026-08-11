import { DELETE as DELETE_REQUEST, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const path = (projectRef: string, resource = "") => `${config.apiPath}/app/projects/${projectRef}${resource}`;
const unwrap = <T>(response: { data: T | { data: T } }): T => response.data && typeof response.data === "object" && "data" in response.data ? (response.data as { data: T }).data : response.data as T;

export type AppOverview = { project_id:number;customers:number;referrals:number;configured_platforms:number };
export type AppCustomer = { id:string;external_id:string;email?:string|null;name?:string|null;platform?:string|null;country_code?:string|null;attributes:Record<string,unknown>;first_seen_at:string;last_seen_at:string;created_at?:string;updated_at?:string;total_views?:number;total_opens?:number;total_installs?:number;total_reinstalls?:number;total_reactivations?:number;total_app_opens?:number;total_user_referred?:number;total_time_spent?:number;total_revenue?:number };
export type AppReferral = { id:string;code:string;customer_id?:string|null;invited_customer_id?:string|null;customer_external_id?:string|null;invited_customer_external_id?:string|null;source?:string|null;status:string;converted_at?:string|null;created_at:string;views?:number;opens?:number;installs?:number;reinstalls?:number;reactivations?:number;invited_users?:number;time_spent?:number;total_revenue?:number };
export type AppAnalyticsFilters = { from?:string;to?:string;timezone?:string;platform?:string };
export type AccessKeyInfo = { id:string;prefix:string;created_at:string;last_used_at?:string|null;revoked_at?:string|null;secret?:string };
export type SdkPlatform = "ios"|"android"|"web";
export type SdkConfiguration = { platform:SdkPlatform;status:"configured"|"verified"|"error";configuration:Record<string,unknown>;verified_at?:string|null;updated_at:string };

export async function getAppOverview(projectRef:string){return unwrap<AppOverview>(await GET(path(projectRef)));}
function analyticsQuery(filters:AppAnalyticsFilters={}){const query=new URLSearchParams();for(const[key,value]of Object.entries(filters)){if(value)query.set(key,value);}return query;}
export async function getCustomers(projectRef:string,search="",offset=0,filters:AppAnalyticsFilters={}){const query=analyticsQuery(filters);query.set("limit","50");query.set("offset",String(offset));if(search)query.set("search",search);const response=await GET(`${path(projectRef,"/customers")}?${query}`);return {items:unwrap<AppCustomer[]>(response),meta:(response.data as {meta?:{total:number;limit:number;offset:number}}).meta};}
export async function createCustomer(projectRef:string,payload:Record<string,unknown>){return unwrap<{id:string}>(await POST(path(projectRef,"/customers"),payload));}
export async function deleteCustomer(projectRef:string,id:string){return unwrap<{deleted:boolean}>(await DELETE_REQUEST(path(projectRef,`/customers/${id}`)));}
export async function getReferrals(projectRef:string,filters:AppAnalyticsFilters={}){const query=analyticsQuery(filters).toString();return unwrap<AppReferral[]>(await GET(`${path(projectRef,"/referrals")}${query?`?${query}`:""}`));}
export async function createReferral(projectRef:string,payload:Record<string,unknown>){return unwrap<{id:string}>(await POST(path(projectRef,"/referrals"),payload));}
export async function getAccessKey(projectRef:string){return unwrap<AccessKeyInfo|null>(await GET(path(projectRef,"/access-key")));}
export async function rotateAccessKey(projectRef:string){return unwrap<AccessKeyInfo>(await POST(path(projectRef,"/access-key/rotate"),{}));}
export async function getSdkConfiguration(projectRef:string,platform:SdkPlatform){return unwrap<SdkConfiguration|null>(await GET(path(projectRef,`/setup/${platform}`)));}
export async function saveSdkConfiguration(projectRef:string,platform:SdkPlatform,payload:Record<string,unknown>){return unwrap<SdkConfiguration>(await PUT(path(projectRef,`/setup/${platform}`),payload));}
export async function testSdkConfiguration(projectRef:string,platform:SdkPlatform){return unwrap<{ok:boolean;verified_at:string}>(await POST(path(projectRef,`/setup/${platform}/test`),{}));}
export async function deleteSdkConfiguration(projectRef:string,platform:SdkPlatform){return unwrap<{deleted:boolean}>(await DELETE_REQUEST(path(projectRef,`/setup/${platform}`)));}
