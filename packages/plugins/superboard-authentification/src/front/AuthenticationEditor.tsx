import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Dialog } from "@superboard/front-ui/kumo";
import { NavigationProvider, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { lazy, Suspense, type ComponentType } from "react";

import { useAuthenticationI18n } from "./AuthenticationTabs.js";
import IdentityPanel from "./IdentityPanel.js";
import { OperatorProfile } from "./OperatorProfile.js";

interface Editor {
	view: "users" | "settings";
	tab: string;
	label: string;
	edit: ComponentType;
	create?: ComponentType;
	identity: boolean;
}
const editors: Record<string, Editor> = {
	apps: {
		view: "settings",
		tab: "apps",
		label: "apps",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/apps/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/apps/new/page.js")),
	},
	banners: {
		view: "settings",
		tab: "apps",
		label: "banners",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/apps/banners/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/apps/banners/new/page.js")),
	},
	roles: {
		view: "settings",
		tab: "roles",
		label: "roles",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/roles/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/roles/new/page.js")),
	},
	scopes: {
		view: "settings",
		tab: "permissions",
		label: "permissions",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/scopes/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/scopes/new/page.js")),
	},
	orgs: {
		view: "settings",
		tab: "organizations",
		label: "organizations",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/orgs/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/orgs/new/page.js")),
	},
	fields: {
		view: "settings",
		tab: "fields",
		label: "fields",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/user-attributes/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/user-attributes/new/page.js")),
	},
	saml: {
		view: "settings",
		tab: "login",
		label: "sso",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/saml/[id]/page.js")),
		create: lazy(() => import("./app/(protected)/identity/[lang]/saml/new/page.js")),
	},
	users: {
		view: "users",
		tab: "accounts",
		label: "accounts",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/users/[authId]/page.js")),
	},
	email: {
		view: "settings",
		tab: "logs",
		label: "email",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/logs/email/[id]/page.js")),
	},
	sms: {
		view: "settings",
		tab: "logs",
		label: "sms",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/logs/sms/[id]/page.js")),
	},
	"sign-in": {
		view: "settings",
		tab: "logs",
		label: "sign-in",
		identity: true,
		edit: lazy(() => import("./app/(protected)/identity/[lang]/logs/sign-in/[id]/page.js")),
	},
	profile: {
		view: "settings",
		tab: "security",
		label: "profile",
		identity: false,
		edit: OperatorProfile,
	},
	account: {
		view: "settings",
		tab: "security",
		label: "account",
		identity: false,
		edit: () => <OperatorProfile security />,
	},
};

export default function AuthenticationEditor({ view }: { view: "users" | "settings" }) {
	const search = useSearchParams();
	const router = useRouter();
	const { locale, path } = useFrontContext();
	const i18n = useAuthenticationI18n();
	const name = search.get("editor") ?? "";
	const editor = Object.hasOwn(editors, name) ? editors[name] : undefined;
	const id = search.get("id") ?? "";
	const Panel = id === "new" ? editor?.create : editor?.edit;
	if (!name) return null;
	const valid =
		editor &&
		editor.view === view &&
		editor.tab === search.get("tab") &&
		Panel &&
		(!editor.identity || (id.length > 0 && id.length <= 512 && !/[\u0000-\u001f]/u.test(id)));
	const close = () => {
		const next = new URLSearchParams(search);
		next.delete("editor");
		next.delete("id");
		router.push(`${path}?${next}`);
	};
	const content = valid ? (
		<Panel key={`${name}:${id}`} />
	) : (
		<p role="alert">{i18n._("notFound")}</p>
	);
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
			disablePointerDismissal
		>
			<Dialog
				size="xl"
				className="max-h-[90dvh] w-[min(70rem,calc(100vw-2rem))] overflow-y-auto p-5"
			>
				<div className="flex items-center justify-between gap-4">
					<Dialog.Title className="text-lg font-semibold">
						{i18n._(editor?.label ?? "notFound")}
					</Dialog.Title>
					<Button onClick={close}>{i18n._("close")}</Button>
				</div>
				<NavigationProvider path={path} parameters={{ lang: locale, id, authId: id }}>
					<Suspense fallback={<p role="status">{i18n._("loading")}</p>}>
						{valid && editor.identity ? <IdentityPanel>{content}</IdentityPanel> : content}
					</Suspense>
				</NavigationProvider>
			</Dialog>
		</Dialog.Root>
	);
}
