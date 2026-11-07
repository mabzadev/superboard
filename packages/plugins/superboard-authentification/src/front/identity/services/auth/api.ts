import { authApi as api } from "./index.js";
export const addTagTypes = [
	"Scopes",
	"Roles",
	"Apps",
	"Users",
	"User Attributes",
	"Logs",
	"System",
] as const;
const injectedRtkApi = api.enhanceEndpoints({ addTagTypes }).injectEndpoints({
	endpoints: (build) => ({
		getApiV1Scopes: build.query<GetApiV1ScopesApiResponse, GetApiV1ScopesApiArg>({
			query: () => ({ url: "/api/v1/scopes" }),
			providesTags: ["Scopes"],
		}),
		postApiV1Scopes: build.mutation<PostApiV1ScopesApiResponse, PostApiV1ScopesApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/scopes",
				method: "POST",
				body: queryArg.postScopeReq,
			}),
			invalidatesTags: ["Scopes"],
		}),
		getApiV1ScopesById: build.query<GetApiV1ScopesByIdApiResponse, GetApiV1ScopesByIdApiArg>({
			query: (queryArg) => ({ url: `/api/v1/scopes/${queryArg.id}` }),
			providesTags: ["Scopes"],
		}),
		putApiV1ScopesById: build.mutation<PutApiV1ScopesByIdApiResponse, PutApiV1ScopesByIdApiArg>({
			query: (queryArg) => ({
				url: `/api/v1/scopes/${queryArg.id}`,
				method: "PUT",
				body: queryArg.putScopeReq,
			}),
			invalidatesTags: ["Scopes"],
		}),
		deleteApiV1ScopesById: build.mutation<
			DeleteApiV1ScopesByIdApiResponse,
			DeleteApiV1ScopesByIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/scopes/${queryArg.id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Scopes"],
		}),
		getApiV1Roles: build.query<GetApiV1RolesApiResponse, GetApiV1RolesApiArg>({
			query: () => ({ url: "/api/v1/roles" }),
			providesTags: ["Roles"],
		}),
		postApiV1Roles: build.mutation<PostApiV1RolesApiResponse, PostApiV1RolesApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/roles",
				method: "POST",
				body: queryArg.postRoleReq,
			}),
			invalidatesTags: ["Roles"],
		}),
		getApiV1RolesById: build.query<GetApiV1RolesByIdApiResponse, GetApiV1RolesByIdApiArg>({
			query: (queryArg) => ({ url: `/api/v1/roles/${queryArg.id}` }),
			providesTags: ["Roles"],
		}),
		putApiV1RolesById: build.mutation<PutApiV1RolesByIdApiResponse, PutApiV1RolesByIdApiArg>({
			query: (queryArg) => ({
				url: `/api/v1/roles/${queryArg.id}`,
				method: "PUT",
				body: queryArg.putRoleReq,
			}),
			invalidatesTags: ["Roles"],
		}),
		deleteApiV1RolesById: build.mutation<
			DeleteApiV1RolesByIdApiResponse,
			DeleteApiV1RolesByIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/roles/${queryArg.id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Roles"],
		}),
		getApiV1RolesByIdUsers: build.query<
			GetApiV1RolesByIdUsersApiResponse,
			GetApiV1RolesByIdUsersApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/roles/${queryArg.id}/users` }),
			providesTags: ["Roles"],
		}),
		getApiV1Apps: build.query<GetApiV1AppsApiResponse, GetApiV1AppsApiArg>({
			query: () => ({ url: "/api/v1/apps" }),
			providesTags: ["Apps"],
		}),
		postApiV1Apps: build.mutation<PostApiV1AppsApiResponse, PostApiV1AppsApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/apps",
				method: "POST",
				body: queryArg.postAppReq,
			}),
			invalidatesTags: ["Apps"],
		}),
		getApiV1AppsById: build.query<GetApiV1AppsByIdApiResponse, GetApiV1AppsByIdApiArg>({
			query: (queryArg) => ({ url: `/api/v1/apps/${queryArg.id}` }),
			providesTags: ["Apps"],
		}),
		putApiV1AppsById: build.mutation<PutApiV1AppsByIdApiResponse, PutApiV1AppsByIdApiArg>({
			query: (queryArg) => ({
				url: `/api/v1/apps/${queryArg.id}`,
				method: "PUT",
				body: queryArg.putAppReq,
			}),
			invalidatesTags: ["Apps"],
		}),
		deleteApiV1AppsById: build.mutation<DeleteApiV1AppsByIdApiResponse, DeleteApiV1AppsByIdApiArg>({
			query: (queryArg) => ({
				url: `/api/v1/apps/${queryArg.id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Apps"],
		}),
		getApiV1Users: build.query<GetApiV1UsersApiResponse, GetApiV1UsersApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/users",
				params: {
					page_size: queryArg.pageSize,
					page_number: queryArg.pageNumber,
					search: queryArg.search,
				},
			}),
			providesTags: ["Users"],
		}),
		getApiV1UsersByAuthId: build.query<
			GetApiV1UsersByAuthIdApiResponse,
			GetApiV1UsersByAuthIdApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/users/${queryArg.authId}` }),
			providesTags: ["Users"],
		}),
		putApiV1UsersByAuthId: build.mutation<
			PutApiV1UsersByAuthIdApiResponse,
			PutApiV1UsersByAuthIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}`,
				method: "PUT",
				body: queryArg.putUserReq,
			}),
			invalidatesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthId: build.mutation<
			DeleteApiV1UsersByAuthIdApiResponse,
			DeleteApiV1UsersByAuthIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		getApiV1UsersByAuthIdLockedIps: build.query<
			GetApiV1UsersByAuthIdLockedIpsApiResponse,
			GetApiV1UsersByAuthIdLockedIpsApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/users/${queryArg.authId}/locked-ips` }),
			providesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdLockedIps: build.mutation<
			DeleteApiV1UsersByAuthIdLockedIpsApiResponse,
			DeleteApiV1UsersByAuthIdLockedIpsApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/locked-ips`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersByAuthIdVerifyEmail: build.mutation<
			PostApiV1UsersByAuthIdVerifyEmailApiResponse,
			PostApiV1UsersByAuthIdVerifyEmailApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/verify-email`,
				method: "POST",
			}),
			invalidatesTags: ["Users"],
		}),
		getApiV1UsersByAuthIdConsentedApps: build.query<
			GetApiV1UsersByAuthIdConsentedAppsApiResponse,
			GetApiV1UsersByAuthIdConsentedAppsApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/users/${queryArg.authId}/consented-apps` }),
			providesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdConsentedAppsAndAppId: build.mutation<
			DeleteApiV1UsersByAuthIdConsentedAppsAndAppIdApiResponse,
			DeleteApiV1UsersByAuthIdConsentedAppsAndAppIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/consented-apps/${queryArg.appId}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		getApiV1UsersByAuthIdPasskeys: build.query<
			GetApiV1UsersByAuthIdPasskeysApiResponse,
			GetApiV1UsersByAuthIdPasskeysApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/users/${queryArg.authId}/passkeys` }),
			providesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdPasskeysAndPasskeyId: build.mutation<
			DeleteApiV1UsersByAuthIdPasskeysAndPasskeyIdApiResponse,
			DeleteApiV1UsersByAuthIdPasskeysAndPasskeyIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/passkeys/${queryArg.passkeyId}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersByAuthIdEmailMfa: build.mutation<
			PostApiV1UsersByAuthIdEmailMfaApiResponse,
			PostApiV1UsersByAuthIdEmailMfaApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/email-mfa`,
				method: "POST",
			}),
			invalidatesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdEmailMfa: build.mutation<
			DeleteApiV1UsersByAuthIdEmailMfaApiResponse,
			DeleteApiV1UsersByAuthIdEmailMfaApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/email-mfa`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersByAuthIdOtpMfa: build.mutation<
			PostApiV1UsersByAuthIdOtpMfaApiResponse,
			PostApiV1UsersByAuthIdOtpMfaApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/otp-mfa`,
				method: "POST",
			}),
			invalidatesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdOtpMfa: build.mutation<
			DeleteApiV1UsersByAuthIdOtpMfaApiResponse,
			DeleteApiV1UsersByAuthIdOtpMfaApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/otp-mfa`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersByAuthIdAccountLinkingAndLinkingAuthId: build.mutation<
			PostApiV1UsersByAuthIdAccountLinkingAndLinkingAuthIdApiResponse,
			PostApiV1UsersByAuthIdAccountLinkingAndLinkingAuthIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/account-linking/${queryArg.linkingAuthId}`,
				method: "POST",
			}),
			invalidatesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdAccountLinking: build.mutation<
			DeleteApiV1UsersByAuthIdAccountLinkingApiResponse,
			DeleteApiV1UsersByAuthIdAccountLinkingApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/account-linking`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersByAuthIdImpersonationAndAppId: build.mutation<
			PostApiV1UsersByAuthIdImpersonationAndAppIdApiResponse,
			PostApiV1UsersByAuthIdImpersonationAndAppIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/impersonation/${queryArg.appId}`,
				method: "POST",
				body: queryArg.body,
			}),
			invalidatesTags: ["Users"],
		}),
		getApiV1UsersByAuthIdActiveSessions: build.query<
			GetApiV1UsersByAuthIdActiveSessionsApiResponse,
			GetApiV1UsersByAuthIdActiveSessionsApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/users/${queryArg.authId}/active-sessions` }),
			providesTags: ["Users"],
		}),
		deleteApiV1UsersByAuthIdActiveSessionsAndSessionId: build.mutation<
			DeleteApiV1UsersByAuthIdActiveSessionsAndSessionIdApiResponse,
			DeleteApiV1UsersByAuthIdActiveSessionsAndSessionIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/${queryArg.authId}/active-sessions/${queryArg.sessionId}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersInvitationsByAuthId: build.mutation<
			PostApiV1UsersInvitationsByAuthIdApiResponse,
			PostApiV1UsersInvitationsByAuthIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/invitations/${queryArg.authId}`,
				method: "POST",
				body: queryArg.body,
			}),
			invalidatesTags: ["Users"],
		}),
		deleteApiV1UsersInvitationsByAuthId: build.mutation<
			DeleteApiV1UsersInvitationsByAuthIdApiResponse,
			DeleteApiV1UsersInvitationsByAuthIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/users/invitations/${queryArg.authId}`,
				method: "DELETE",
			}),
			invalidatesTags: ["Users"],
		}),
		postApiV1UsersInvitations: build.mutation<
			PostApiV1UsersInvitationsApiResponse,
			PostApiV1UsersInvitationsApiArg
		>({
			query: (queryArg) => ({
				url: "/api/v1/users/invitations",
				method: "POST",
				body: queryArg.body,
			}),
			invalidatesTags: ["Users"],
		}),
		getApiV1UserAttributes: build.query<
			GetApiV1UserAttributesApiResponse,
			GetApiV1UserAttributesApiArg
		>({
			query: () => ({ url: "/api/v1/user-attributes" }),
			providesTags: ["User Attributes"],
		}),
		postApiV1UserAttributes: build.mutation<
			PostApiV1UserAttributesApiResponse,
			PostApiV1UserAttributesApiArg
		>({
			query: (queryArg) => ({
				url: "/api/v1/user-attributes",
				method: "POST",
				body: queryArg.postUserAttributeReq,
			}),
			invalidatesTags: ["User Attributes"],
		}),
		getApiV1UserAttributesById: build.query<
			GetApiV1UserAttributesByIdApiResponse,
			GetApiV1UserAttributesByIdApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/user-attributes/${queryArg.id}` }),
			providesTags: ["User Attributes"],
		}),
		putApiV1UserAttributesById: build.mutation<
			PutApiV1UserAttributesByIdApiResponse,
			PutApiV1UserAttributesByIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/user-attributes/${queryArg.id}`,
				method: "PUT",
				body: queryArg.putUserAttributeReq,
			}),
			invalidatesTags: ["User Attributes"],
		}),
		deleteApiV1UserAttributesById: build.mutation<
			DeleteApiV1UserAttributesByIdApiResponse,
			DeleteApiV1UserAttributesByIdApiArg
		>({
			query: (queryArg) => ({
				url: `/api/v1/user-attributes/${queryArg.id}`,
				method: "DELETE",
			}),
			invalidatesTags: ["User Attributes"],
		}),
		getApiV1LogsEmail: build.query<GetApiV1LogsEmailApiResponse, GetApiV1LogsEmailApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/logs/email",
				params: {
					page_size: queryArg.pageSize,
					page_number: queryArg.pageNumber,
				},
			}),
			providesTags: ["Logs"],
		}),
		deleteApiV1LogsEmail: build.mutation<
			DeleteApiV1LogsEmailApiResponse,
			DeleteApiV1LogsEmailApiArg
		>({
			query: (queryArg) => ({
				url: "/api/v1/logs/email",
				method: "DELETE",
				params: { before: queryArg.before },
			}),
			invalidatesTags: ["Logs"],
		}),
		getApiV1LogsEmailById: build.query<
			GetApiV1LogsEmailByIdApiResponse,
			GetApiV1LogsEmailByIdApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/logs/email/${queryArg.id}` }),
			providesTags: ["Logs"],
		}),
		getApiV1LogsSignIn: build.query<GetApiV1LogsSignInApiResponse, GetApiV1LogsSignInApiArg>({
			query: (queryArg) => ({
				url: "/api/v1/logs/sign-in",
				params: {
					page_size: queryArg.pageSize,
					page_number: queryArg.pageNumber,
				},
			}),
			providesTags: ["Logs"],
		}),
		deleteApiV1LogsSignIn: build.mutation<
			DeleteApiV1LogsSignInApiResponse,
			DeleteApiV1LogsSignInApiArg
		>({
			query: (queryArg) => ({
				url: "/api/v1/logs/sign-in",
				method: "DELETE",
				params: { before: queryArg.before },
			}),
			invalidatesTags: ["Logs"],
		}),
		getApiV1LogsSignInById: build.query<
			GetApiV1LogsSignInByIdApiResponse,
			GetApiV1LogsSignInByIdApiArg
		>({
			query: (queryArg) => ({ url: `/api/v1/logs/sign-in/${queryArg.id}` }),
			providesTags: ["Logs"],
		}),
		getInfo: build.query<GetInfoApiResponse, GetInfoApiArg>({
			query: () => ({ url: "/info" }),
			providesTags: ["System"],
		}),
	}),
	overrideExisting: false,
});
export { injectedRtkApi as authApi };
export type GetApiV1ScopesApiResponse = {
	scopes?: Scope[];
};
export type GetApiV1ScopesApiArg = void;
export type PostApiV1ScopesApiResponse = {
	scope?: ScopeDetail;
};
export type PostApiV1ScopesApiArg = {
	postScopeReq: PostScopeReq;
};
export type GetApiV1ScopesByIdApiResponse = {
	scope?: ScopeDetail;
};
export type GetApiV1ScopesByIdApiArg = {
	id: number;
};
export type PutApiV1ScopesByIdApiResponse = {
	scope?: ScopeDetail;
};
export type PutApiV1ScopesByIdApiArg = {
	id: number;
	putScopeReq: PutScopeReq;
};
export type DeleteApiV1ScopesByIdApiResponse = unknown;
export type DeleteApiV1ScopesByIdApiArg = {
	id: number;
};
export type GetApiV1RolesApiResponse = {
	roles?: Role[];
};
export type GetApiV1RolesApiArg = void;
export type PostApiV1RolesApiResponse = {
	role?: Role;
};
export type PostApiV1RolesApiArg = {
	postRoleReq: PostRoleReq;
};
export type GetApiV1RolesByIdApiResponse = {
	role?: Role;
};
export type GetApiV1RolesByIdApiArg = {
	id: number;
};
export type PutApiV1RolesByIdApiResponse = {
	role?: Role;
};
export type PutApiV1RolesByIdApiArg = {
	id: number;
	putRoleReq: PutRoleReq;
};
export type DeleteApiV1RolesByIdApiResponse = unknown;
export type DeleteApiV1RolesByIdApiArg = {
	id: number;
};
export type GetApiV1RolesByIdUsersApiResponse = {
	users?: User[];
};
export type GetApiV1RolesByIdUsersApiArg = {
	id: number;
};
export type GetApiV1AppsApiResponse = {
	apps?: App[];
};
export type GetApiV1AppsApiArg = void;
export type PostApiV1AppsApiResponse = {
	app?: CreatedAppDetail;
};
export type PostApiV1AppsApiArg = {
	postAppReq: PostAppReq;
};
export type GetApiV1AppsByIdApiResponse = {
	app?: AppDetail;
};
export type GetApiV1AppsByIdApiArg = {
	id: number;
};
export type PutApiV1AppsByIdApiResponse = {
	app?: AppDetail;
};
export type PutApiV1AppsByIdApiArg = {
	id: number;
	putAppReq: PutAppReq;
};
export type DeleteApiV1AppsByIdApiResponse = unknown;
export type DeleteApiV1AppsByIdApiArg = {
	id: number;
};
export type GetApiV1UsersApiResponse = {
	users?: User[];
	count?: number;
};
export type GetApiV1UsersApiArg = {
	pageSize?: number;
	pageNumber?: number;
	search?: string;
};
export type GetApiV1UsersByAuthIdApiResponse = {
	user?: UserDetail;
};
export type GetApiV1UsersByAuthIdApiArg = {
	authId: string;
};
export type PutApiV1UsersByAuthIdApiResponse = {
	user?: UserDetail;
};
export type PutApiV1UsersByAuthIdApiArg = {
	authId: string;
	putUserReq: PutUserReq;
};
export type DeleteApiV1UsersByAuthIdApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdApiArg = {
	authId: string;
};
export type GetApiV1UsersByAuthIdLockedIpsApiResponse = {
	lockedIPs?: string[];
};
export type GetApiV1UsersByAuthIdLockedIpsApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdLockedIpsApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdLockedIpsApiArg = {
	authId: string;
};
export type PostApiV1UsersByAuthIdVerifyEmailApiResponse = {
	success?: boolean;
};
export type PostApiV1UsersByAuthIdVerifyEmailApiArg = {
	authId: string;
};
export type GetApiV1UsersByAuthIdConsentedAppsApiResponse = {
	consentedApps?: UserConsentedApp[];
};
export type GetApiV1UsersByAuthIdConsentedAppsApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdConsentedAppsAndAppIdApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdConsentedAppsAndAppIdApiArg = {
	authId: string;
	appId: number;
};
export type GetApiV1UsersByAuthIdPasskeysApiResponse = {
	passkeys?: UserPasskey[];
};
export type GetApiV1UsersByAuthIdPasskeysApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdPasskeysAndPasskeyIdApiResponse = {
	success?: boolean;
};
export type DeleteApiV1UsersByAuthIdPasskeysAndPasskeyIdApiArg = {
	authId: string;
	passkeyId: number;
};
export type PostApiV1UsersByAuthIdEmailMfaApiResponse = unknown;
export type PostApiV1UsersByAuthIdEmailMfaApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdEmailMfaApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdEmailMfaApiArg = {
	authId: string;
};
export type PostApiV1UsersByAuthIdOtpMfaApiResponse = unknown;
export type PostApiV1UsersByAuthIdOtpMfaApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdOtpMfaApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdOtpMfaApiArg = {
	authId: string;
};
export type PostApiV1UsersByAuthIdAccountLinkingAndLinkingAuthIdApiResponse = {
	success?: boolean;
};
export type PostApiV1UsersByAuthIdAccountLinkingAndLinkingAuthIdApiArg = {
	authId: string;
	linkingAuthId: string;
};
export type DeleteApiV1UsersByAuthIdAccountLinkingApiResponse = {
	success?: boolean;
};
export type DeleteApiV1UsersByAuthIdAccountLinkingApiArg = {
	authId: string;
};
export type PostApiV1UsersByAuthIdImpersonationAndAppIdApiResponse = {
	refresh_token?: string;
	refresh_token_expires_on?: number;
	refresh_token_expires_in?: number;
};
export type PostApiV1UsersByAuthIdImpersonationAndAppIdApiArg = {
	authId: string;
	appId: number;
	body: {
		impersonatorToken?: string;
	};
};
export type GetApiV1UsersByAuthIdActiveSessionsApiResponse = {
	activeSessions?: {
		sessionId?: string;
		expiredAt?: number;
		authId?: string;
		clientId?: string;
		scope?: string;
		roles?: string[];
	}[];
};
export type GetApiV1UsersByAuthIdActiveSessionsApiArg = {
	authId: string;
};
export type DeleteApiV1UsersByAuthIdActiveSessionsAndSessionIdApiResponse = unknown;
export type DeleteApiV1UsersByAuthIdActiveSessionsAndSessionIdApiArg = {
	authId: string;
	sessionId: string;
};
export type PostApiV1UsersInvitationsByAuthIdApiResponse = {
	success?: boolean;
};
export type PostApiV1UsersInvitationsByAuthIdApiArg = {
	authId: string;
	body: {
		locale?: string;
		signinUrl?: string;
	};
};
export type DeleteApiV1UsersInvitationsByAuthIdApiResponse = unknown;
export type DeleteApiV1UsersInvitationsByAuthIdApiArg = {
	authId: string;
};
export type PostApiV1UsersInvitationsApiResponse = {
	user?: UserDetail;
};
export type PostApiV1UsersInvitationsApiArg = {
	body: {
		email: string;
		firstName?: string;
		lastName?: string;
		locale?: string;
		roles?: string[];
		signinUrl?: string;
	};
};
export type GetApiV1UserAttributesApiResponse = {
	userAttributes?: UserAttribute[];
};
export type GetApiV1UserAttributesApiArg = void;
export type PostApiV1UserAttributesApiResponse = {
	userAttribute?: UserAttribute;
};
export type PostApiV1UserAttributesApiArg = {
	postUserAttributeReq: PostUserAttributeReq;
};
export type GetApiV1UserAttributesByIdApiResponse = {
	userAttribute?: UserAttribute;
};
export type GetApiV1UserAttributesByIdApiArg = {
	id: number;
};
export type PutApiV1UserAttributesByIdApiResponse = {
	userAttribute?: UserAttribute;
};
export type PutApiV1UserAttributesByIdApiArg = {
	id: number;
	putUserAttributeReq: PutUserAttributeReq;
};
export type DeleteApiV1UserAttributesByIdApiResponse = unknown;
export type DeleteApiV1UserAttributesByIdApiArg = {
	id: number;
};
export type GetApiV1LogsEmailApiResponse = {
	logs?: EmailLog[];
	count?: number;
};
export type GetApiV1LogsEmailApiArg = {
	pageSize?: number;
	pageNumber?: number;
};
export type DeleteApiV1LogsEmailApiResponse = unknown;
export type DeleteApiV1LogsEmailApiArg = {
	before?: string;
};
export type GetApiV1LogsEmailByIdApiResponse = {
	log?: EmailLog;
};
export type GetApiV1LogsEmailByIdApiArg = {
	id: number;
};
export type GetApiV1LogsSignInApiResponse = {
	logs?: SignInLog[];
	count?: number;
};
export type GetApiV1LogsSignInApiArg = {
	pageSize?: number;
	pageNumber?: number;
};
export type DeleteApiV1LogsSignInApiResponse = unknown;
export type DeleteApiV1LogsSignInApiArg = {
	before?: string;
};
export type GetApiV1LogsSignInByIdApiResponse = {
	log?: SignInLog;
};
export type GetApiV1LogsSignInByIdApiArg = {
	id: number;
};
export type GetInfoApiResponse = {
	configs?: {
		[key: string]: unknown;
	};
};
export type GetInfoApiArg = void;
export type Scope = {
	id: number;
	name: string;
	note: string;
	type: "spa" | "s2s";
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type ScopeDetail = Scope & {
	locales: {
		id: number;
		scopeId: number;
		locale: string;
		value: string;
		createdAt: string;
		updatedAt: string;
		deletedAt: string | null;
	}[];
};
export type PostScopeReq = {
	name: string;
	type: "spa" | "s2s";
	note?: string;
	locales?: {
		locale: string;
		value: string;
	}[];
};
export type PutScopeReq = {
	name?: string;
	note?: string;
	locales?: {
		locale: string;
		value: string;
	}[];
};
export type Role = {
	id: number;
	name: string;
	note: string;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type PostRoleReq = {
	name: string;
	note?: string;
};
export type PutRoleReq = {
	name?: string;
	note?: string;
};
export type User = {
	id: number;
	authId: string;
	email: string | null;
	linkedAuthId?: string | null;
	socialAccountId: string | null;
	socialAccountType: string | null;
	firstName: string | null;
	lastName: string | null;
	locale: string;
	loginCount: number;
	mfaTypes: string[];
	emailVerified: boolean;
	otpVerified: boolean;
	isActive: boolean;
	isInviting: boolean;
	invitationExpiresAt?: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type App = {
	id: number;
	clientId: string;
	name: string;
	isActive: boolean;
	type: "spa" | "s2s";
	redirectUris: string[];
	useSystemMfaConfig: boolean;
	requireEmailMfa: boolean;
	requireOtpMfa: boolean;
	allowEmailMfaAsBackup: boolean;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type AppDetail = App & {
	scopes: string[];
};
export type CreatedAppDetail = AppDetail & {
	secret: string;
};
export type PostAppReq = {
	name: string;
	type: "spa" | "s2s";
	scopes: string[];
	redirectUris: string[];
};
export type PutAppReq = {
	redirectUris?: string[];
	name?: string;
	isActive?: boolean;
	scopes?: string[];
	useSystemMfaConfig?: boolean;
	requireEmailMfa?: boolean;
	requireOtpMfa?: boolean;
	allowEmailMfaAsBackup?: boolean;
};
export type UserDetail = User & {
	roles: string[] | null;
	attributes?: {
		[key: string]: string;
	} | null;
};
export type PutUserReq = {
	firstName?: string;
	lastName?: string;
	isActive?: boolean;
	locale?: string;
	roles?: string[];
	attributes?: {
		[key: string]: string | null;
	};
};
export type UserConsentedApp = {
	appId: number;
	appName: string;
};
export type UserPasskey = {
	id: number;
	credentialId: string;
	counter: number;
};
export type UserAttribute = {
	id: number;
	name: string;
	locales?: {
		locale: string;
		value: string;
	}[];
	includeInSignUpForm: boolean;
	requiredInSignUpForm: boolean;
	includeInIdTokenBody: boolean;
	includeInUserInfo: boolean;
	unique: boolean;
	validationRegex: string;
	validationLocales: {
		locale: string;
		value: string;
	}[];
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type PostUserAttributeReq = {
	name: string;
	locales?: {
		locale: string;
		value: string;
	}[];
	includeInSignUpForm: boolean;
	requiredInSignUpForm: boolean;
	includeInIdTokenBody: boolean;
	includeInUserInfo: boolean;
	unique: boolean;
	validationRegex?: string;
	validationLocales?: {
		locale: string;
		value: string;
	}[];
};
export type PutUserAttributeReq = {
	name?: string;
	locales?: {
		locale: string;
		value: string;
	}[];
	includeInSignUpForm?: boolean;
	requiredInSignUpForm?: boolean;
	includeInIdTokenBody?: boolean;
	includeInUserInfo?: boolean;
	unique?: boolean;
	validationRegex?: string;
	validationLocales?: {
		locale: string;
		value: string;
	}[];
};
export type EmailLog = {
	id: number;
	success: boolean;
	receiver: string;
	response: string;
	content: string;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export type SignInLog = {
	id: number;
	userId: number;
	ip: string | null;
	detail: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};
export const {
	useGetApiV1ScopesQuery,
	useLazyGetApiV1ScopesQuery,
	usePostApiV1ScopesMutation,
	useGetApiV1ScopesByIdQuery,
	useLazyGetApiV1ScopesByIdQuery,
	usePutApiV1ScopesByIdMutation,
	useDeleteApiV1ScopesByIdMutation,
	useGetApiV1RolesQuery,
	useLazyGetApiV1RolesQuery,
	usePostApiV1RolesMutation,
	useGetApiV1RolesByIdQuery,
	useLazyGetApiV1RolesByIdQuery,
	usePutApiV1RolesByIdMutation,
	useDeleteApiV1RolesByIdMutation,
	useGetApiV1RolesByIdUsersQuery,
	useLazyGetApiV1RolesByIdUsersQuery,
	useGetApiV1AppsQuery,
	useLazyGetApiV1AppsQuery,
	usePostApiV1AppsMutation,
	useGetApiV1AppsByIdQuery,
	useLazyGetApiV1AppsByIdQuery,
	usePutApiV1AppsByIdMutation,
	useDeleteApiV1AppsByIdMutation,
	useGetApiV1UsersQuery,
	useLazyGetApiV1UsersQuery,
	useGetApiV1UsersByAuthIdQuery,
	useLazyGetApiV1UsersByAuthIdQuery,
	usePutApiV1UsersByAuthIdMutation,
	useDeleteApiV1UsersByAuthIdMutation,
	useGetApiV1UsersByAuthIdLockedIpsQuery,
	useLazyGetApiV1UsersByAuthIdLockedIpsQuery,
	useDeleteApiV1UsersByAuthIdLockedIpsMutation,
	usePostApiV1UsersByAuthIdVerifyEmailMutation,
	useGetApiV1UsersByAuthIdConsentedAppsQuery,
	useLazyGetApiV1UsersByAuthIdConsentedAppsQuery,
	useDeleteApiV1UsersByAuthIdConsentedAppsAndAppIdMutation,
	useGetApiV1UsersByAuthIdPasskeysQuery,
	useLazyGetApiV1UsersByAuthIdPasskeysQuery,
	useDeleteApiV1UsersByAuthIdPasskeysAndPasskeyIdMutation,
	usePostApiV1UsersByAuthIdEmailMfaMutation,
	useDeleteApiV1UsersByAuthIdEmailMfaMutation,
	usePostApiV1UsersByAuthIdOtpMfaMutation,
	useDeleteApiV1UsersByAuthIdOtpMfaMutation,
	usePostApiV1UsersByAuthIdAccountLinkingAndLinkingAuthIdMutation,
	useDeleteApiV1UsersByAuthIdAccountLinkingMutation,
	usePostApiV1UsersByAuthIdImpersonationAndAppIdMutation,
	useGetApiV1UsersByAuthIdActiveSessionsQuery,
	useLazyGetApiV1UsersByAuthIdActiveSessionsQuery,
	useDeleteApiV1UsersByAuthIdActiveSessionsAndSessionIdMutation,
	usePostApiV1UsersInvitationsByAuthIdMutation,
	useDeleteApiV1UsersInvitationsByAuthIdMutation,
	usePostApiV1UsersInvitationsMutation,
	useGetApiV1UserAttributesQuery,
	useLazyGetApiV1UserAttributesQuery,
	usePostApiV1UserAttributesMutation,
	useGetApiV1UserAttributesByIdQuery,
	useLazyGetApiV1UserAttributesByIdQuery,
	usePutApiV1UserAttributesByIdMutation,
	useDeleteApiV1UserAttributesByIdMutation,
	useGetApiV1LogsEmailQuery,
	useLazyGetApiV1LogsEmailQuery,
	useDeleteApiV1LogsEmailMutation,
	useGetApiV1LogsEmailByIdQuery,
	useLazyGetApiV1LogsEmailByIdQuery,
	useGetApiV1LogsSignInQuery,
	useLazyGetApiV1LogsSignInQuery,
	useDeleteApiV1LogsSignInMutation,
	useGetApiV1LogsSignInByIdQuery,
	useLazyGetApiV1LogsSignInByIdQuery,
	useGetInfoQuery,
	useLazyGetInfoQuery,
} = injectedRtkApi;
