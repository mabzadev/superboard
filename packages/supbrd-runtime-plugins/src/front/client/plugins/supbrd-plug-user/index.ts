export const pluginId = "supbrd-plug-user";
export { Providers } from "./Providers.js";
export const views = {
	"superboard.reset_password": () => import("./views/superboard.reset_password.js"),
	"superboard.register_with_email": () => import("./views/superboard.register_with_email.js"),
	"superboard.register": () => import("./views/superboard.register.js"),
	"superboard.new_password": () => import("./views/superboard.new_password.js"),
	"superboard.login": () => import("./views/superboard.login.js"),
	"superboard.profile": () => import("./views/superboard.profile.js"),
	"superboard.account": () => import("./views/superboard.account.js"),
	"superboard.accept_invite": () => import("./views/superboard.accept_invite.js"),
	"superboard.app_access_key": () => import("./views/superboard.app_access_key.js"),
	"superboard.app_customers": () => import("./views/superboard.app_customers.js"),
	"superboard.app_members": () => import("./views/superboard.app_members.js"),
	"superboard.app_referrals": () => import("./views/superboard.app_referrals.js"),
	"superboard.users": () => import("./views/superboard.users.js"),
	"superboard.identity": () => import("./views/superboard.identity.js"),
	"superboard.identity_by_lang": () => import("./views/superboard.identity_by_lang.js"),
	"superboard.identity_by_lang_account": () =>
		import("./views/superboard.identity_by_lang_account.js"),
	"superboard.identity_by_lang_apps": () => import("./views/superboard.identity_by_lang_apps.js"),
	"superboard.identity_by_lang_apps_by_id": () =>
		import("./views/superboard.identity_by_lang_apps_by_id.js"),
	"superboard.identity_by_lang_apps_banners_by_id": () =>
		import("./views/superboard.identity_by_lang_apps_banners_by_id.js"),
	"superboard.identity_by_lang_apps_banners_new": () =>
		import("./views/superboard.identity_by_lang_apps_banners_new.js"),
	"superboard.identity_by_lang_apps_new": () =>
		import("./views/superboard.identity_by_lang_apps_new.js"),
	"superboard.identity_by_lang_dashboard": () =>
		import("./views/superboard.identity_by_lang_dashboard.js"),
	"superboard.identity_by_lang_logs": () => import("./views/superboard.identity_by_lang_logs.js"),
	"superboard.identity_by_lang_logs_email_by_id": () =>
		import("./views/superboard.identity_by_lang_logs_email_by_id.js"),
	"superboard.identity_by_lang_logs_sign_in_by_id": () =>
		import("./views/superboard.identity_by_lang_logs_sign_in_by_id.js"),
	"superboard.identity_by_lang_logs_sms_by_id": () =>
		import("./views/superboard.identity_by_lang_logs_sms_by_id.js"),
	"superboard.identity_by_lang_orgs": () => import("./views/superboard.identity_by_lang_orgs.js"),
	"superboard.identity_by_lang_orgs_by_id": () =>
		import("./views/superboard.identity_by_lang_orgs_by_id.js"),
	"superboard.identity_by_lang_orgs_new": () =>
		import("./views/superboard.identity_by_lang_orgs_new.js"),
	"superboard.identity_by_lang_roles": () => import("./views/superboard.identity_by_lang_roles.js"),
	"superboard.identity_by_lang_roles_by_id": () =>
		import("./views/superboard.identity_by_lang_roles_by_id.js"),
	"superboard.identity_by_lang_roles_new": () =>
		import("./views/superboard.identity_by_lang_roles_new.js"),
	"superboard.identity_by_lang_saml": () => import("./views/superboard.identity_by_lang_saml.js"),
	"superboard.identity_by_lang_saml_by_id": () =>
		import("./views/superboard.identity_by_lang_saml_by_id.js"),
	"superboard.identity_by_lang_saml_new": () =>
		import("./views/superboard.identity_by_lang_saml_new.js"),
	"superboard.identity_by_lang_scopes": () =>
		import("./views/superboard.identity_by_lang_scopes.js"),
	"superboard.identity_by_lang_scopes_by_id": () =>
		import("./views/superboard.identity_by_lang_scopes_by_id.js"),
	"superboard.identity_by_lang_scopes_new": () =>
		import("./views/superboard.identity_by_lang_scopes_new.js"),
	"superboard.identity_by_lang_user_attributes": () =>
		import("./views/superboard.identity_by_lang_user_attributes.js"),
	"superboard.identity_by_lang_user_attributes_by_id": () =>
		import("./views/superboard.identity_by_lang_user_attributes_by_id.js"),
	"superboard.identity_by_lang_user_attributes_new": () =>
		import("./views/superboard.identity_by_lang_user_attributes_new.js"),
	"superboard.identity_by_lang_users": () => import("./views/superboard.identity_by_lang_users.js"),
	"superboard.identity_by_lang_users_by_authid": () =>
		import("./views/superboard.identity_by_lang_users_by_authid.js"),
};
