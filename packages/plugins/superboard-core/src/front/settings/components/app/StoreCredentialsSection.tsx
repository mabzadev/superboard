"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { showSuccessNotification } from "@superboard/front-ui/lib/Notifications.js";
import type { PlatformAppConfig } from "@superboard/front-ui/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superboard/front-ui/ui/alert-dialog.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { useId, useState, type ReactNode } from "react";

import {
	useSetAndroidConfigMutation,
	useSetAndroidWebhookKeyMutation,
	useSetIosApiAccessKeyMutation,
} from "../../hooks/mutations/useInstanceMutations.js";
import { useInstanceConfigQuery } from "../../hooks/queries/useInstanceQueries.js";
import { useSettingsI18n, type SettingsMessage } from "../../i18n.js";

type StorePlatform = "ios" | "android";
type Registration = { bundle_id: string; team_id: string; package_name: string; sha256: string };
type Configuration = PlatformAppConfig["configuration"];

const APPLE_PRIVATE_KEY = /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/u;

export default function StoreCredentialsSection({
	platform,
	registration,
}: {
	platform: StorePlatform;
	registration: Registration;
}) {
	const { t } = useSettingsI18n();
	const headingId = useId();
	const { selectedInstance } = useProjectSelection();
	const instanceId = selectedInstance?.id;
	const config = useInstanceConfigQuery(instanceId);
	const [editing, setEditing] = useState(false);
	const [formKey, setFormKey] = useState(0);
	if (!instanceId) return null;

	const configuration = config.data?.find((item) => item.platform === platform)?.configuration;
	const serverKey = configuration?.server_api_key;
	const apple = platform === "ios";
	const identifier = apple ? configuration?.bundle_id : configuration?.identifier;
	const keyLabel = apple ? serverKey?.key_id : serverKey?.client_email;
	const formProps = {
		instanceId,
		configuration,
		registration,
		replacing: Boolean(serverKey),
		onDone: () => {
			setEditing(false);
			setFormKey((value) => value + 1);
		},
	};

	return (
		<section aria-labelledby={headingId} className="space-y-4 rounded-md border p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h3 id={headingId} className="font-medium">
						{t(apple ? "store.appleTitle" : "store.googleTitle")}
					</h3>
					<p className="text-xs text-muted-foreground">
						{t(apple ? "store.appleDescription" : "store.googleDescription")}
					</p>
				</div>
				{config.data ? (
					<Badge variant={serverKey ? "success" : "outline"}>
						{t(serverKey ? "store.configured" : "store.notConfigured")}
					</Badge>
				) : null}
			</div>
			{config.isPending ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("store.loading")}
				</p>
			) : config.isError ? (
				<div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
					<span>{t("store.loadError")}</span>
					<Button
						variant="outline"
						onClick={() => {
							config.refetch().catch(() => undefined);
						}}
					>
						{t("store.retry")}
					</Button>
				</div>
			) : (
				<>
					{identifier || typeof keyLabel === "string" ? (
						<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
							{identifier ? (
								<div>
									<dt className="text-xs text-muted-foreground">
										{t(apple ? "store.bundleId" : "store.packageName")}
									</dt>
									<dd>
										<code>{identifier}</code>
									</dd>
								</div>
							) : null}
							{typeof keyLabel === "string" ? (
								<div>
									<dt className="text-xs text-muted-foreground">
										{t(apple ? "store.keyId" : "store.serviceAccount")}
									</dt>
									<dd>
										<code>{keyLabel}</code>
									</dd>
								</div>
							) : null}
						</dl>
					) : null}
					{serverKey && !editing ? (
						<Button
							variant="outline"
							onClick={() => {
								setEditing(true);
							}}
						>
							{t("store.replace")}
						</Button>
					) : apple ? (
						<AppleKeyForm key={formKey} {...formProps} />
					) : (
						<GoogleKeyForm key={formKey} {...formProps} />
					)}
				</>
			)}
		</section>
	);
}

type KeyFormProps = {
	instanceId: string;
	configuration: Configuration;
	registration: Registration;
	replacing: boolean;
	onDone: () => void;
};

function AppleKeyForm({
	instanceId,
	configuration,
	registration,
	replacing,
	onDone,
}: KeyFormProps) {
	const { t } = useSettingsI18n();
	const ids = { keyId: useId(), issuerId: useId(), appleAppId: useId(), file: useId() };
	const mutation = useSetIosApiAccessKeyMutation(instanceId);
	const [keyId, setKeyId] = useState("");
	const [issuerId, setIssuerId] = useState("");
	const [appleAppId, setAppleAppId] = useState(() => {
		const current = configuration?.app_apple_id;
		return typeof current === "string" || typeof current === "number" ? String(current) : "";
	});
	const [file, setFile] = useState<File | null>(null);
	const registers = !configuration;
	const bundleId = registration.bundle_id.trim();
	const teamId = registration.team_id.trim();
	const blocked = registers && (!bundleId || !teamId);

	const prepare = async (): Promise<FormData | SettingsMessage> => {
		if (!keyId.trim() || !issuerId.trim() || !appleAppId.trim() || !file)
			return "store.errorRequired";
		if (!/^\d+$/u.test(appleAppId.trim())) return "store.errorAppleAppId";
		if (!APPLE_PRIVATE_KEY.test(await file.text())) return "store.errorAppleKey";
		const upload = new FormData();
		upload.set("file", file);
		upload.set("key_id", keyId.trim());
		upload.set("issuer_id", issuerId.trim());
		upload.set("app_apple_id", appleAppId.trim());
		if (registers) {
			upload.set("bundle_id", bundleId);
			upload.set("team_id", teamId);
		}
		return upload;
	};

	return (
		<KeyForm
			replacing={replacing}
			blocked={blocked}
			prepare={prepare}
			send={async (upload) => {
				await mutation.mutateAsync(upload);
			}}
			onDone={onDone}
			notice={
				blocked ? (
					t("store.missingIosRegistration")
				) : registers ? (
					<>
						{t("store.registersIos")} <code>{bundleId}</code> · <code>{teamId}</code>
					</>
				) : null
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<TextField id={ids.keyId} label={t("store.keyId")} value={keyId} onChange={setKeyId} />
				<TextField
					id={ids.issuerId}
					label={t("store.issuerId")}
					value={issuerId}
					onChange={setIssuerId}
				/>
			</div>
			<div className="space-y-2">
				<TextField
					id={ids.appleAppId}
					label={t("store.appleAppId")}
					value={appleAppId}
					onChange={setAppleAppId}
					inputMode="numeric"
				/>
				<p className="text-xs text-muted-foreground">{t("store.appleAppIdHint")}</p>
			</div>
			<FileField id={ids.file} label={t("store.privateKey")} accept=".p8" onChange={setFile} />
		</KeyForm>
	);
}

function GoogleKeyForm({
	instanceId,
	configuration,
	registration,
	replacing,
	onDone,
}: KeyFormProps) {
	const { t } = useSettingsI18n();
	const fileId = useId();
	const register = useSetAndroidConfigMutation(instanceId);
	const mutation = useSetAndroidWebhookKeyMutation(instanceId);
	const [file, setFile] = useState<File | null>(null);
	const registers = !configuration;
	const packageName = registration.package_name.trim();
	const certificate = registration.sha256.trim();
	const blocked = registers && (!packageName || !certificate);

	const prepare = async (): Promise<FormData | SettingsMessage> => {
		if (!file) return "store.errorRequired";
		if (!file.name.endsWith(".json") || !isServiceAccount(await file.text()))
			return "store.errorGoogleKey";
		const upload = new FormData();
		upload.set("file", file);
		return upload;
	};

	return (
		<KeyForm
			replacing={replacing}
			blocked={blocked}
			prepare={prepare}
			send={async (upload) => {
				if (registers)
					await register.mutateAsync({ package_name: packageName, sha256s: [certificate] });
				await mutation.mutateAsync(upload);
			}}
			onDone={onDone}
			notice={
				blocked ? (
					t("store.missingAndroidRegistration")
				) : registers ? (
					<>
						{t("store.registersAndroid")} <code>{packageName}</code> · <code>{certificate}</code>
					</>
				) : null
			}
		>
			<FileField
				id={fileId}
				label={t("store.serviceAccountKey")}
				accept=".json,application/json"
				onChange={setFile}
			/>
		</KeyForm>
	);
}

function KeyForm({
	replacing,
	blocked,
	prepare,
	send,
	onDone,
	notice,
	children,
}: {
	replacing: boolean;
	blocked: boolean;
	prepare: () => Promise<FormData | SettingsMessage>;
	send: (upload: FormData) => Promise<void>;
	onDone: () => void;
	notice: ReactNode;
	children: ReactNode;
}) {
	const { t } = useSettingsI18n();
	const [error, setError] = useState<SettingsMessage | null>(null);
	const [pending, setPending] = useState<FormData | null>(null);
	const [saving, setSaving] = useState(false);

	const submit = async (upload: FormData) => {
		setPending(null);
		setSaving(true);
		try {
			await send(upload);
			showSuccessNotification(t("store.saved"));
			onDone();
		} catch (cause) {
			setError(failureMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const save = async () => {
		setError(null);
		const upload = await prepare();
		if (!(upload instanceof FormData)) {
			setError(upload);
			return;
		}
		if (replacing) setPending(upload);
		else await submit(upload);
	};

	return (
		<div className="space-y-4">
			{children}
			{notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{t(error)}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={blocked || saving}
					onClick={() => {
						save().catch(() => undefined);
					}}
				>
					{t(saving ? "store.saving" : "store.save")}
				</Button>
				{replacing ? (
					<Button variant="outline" disabled={saving} onClick={onDone}>
						{t("store.cancel")}
					</Button>
				) : null}
			</div>
			<AlertDialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) setPending(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("store.confirmTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("store.confirmDescription")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("store.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (pending) submit(pending).catch(() => undefined);
							}}
						>
							{t("store.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	inputMode,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	inputMode?: "numeric";
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				value={value}
				inputMode={inputMode}
				autoComplete="off"
				spellCheck={false}
				onChange={(event) => {
					onChange(event.currentTarget.value);
				}}
			/>
		</div>
	);
}

function FileField({
	id,
	label,
	accept,
	onChange,
}: {
	id: string;
	label: string;
	accept: string;
	onChange: (file: File | null) => void;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type="file"
				accept={accept}
				onChange={(event) => {
					onChange(event.currentTarget.files?.[0] ?? null);
				}}
			/>
		</div>
	);
}

function isServiceAccount(text: string): boolean {
	try {
		const parsed: unknown = JSON.parse(text);
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "service_account" &&
			"client_email" in parsed &&
			typeof parsed.client_email === "string" &&
			"private_key" in parsed &&
			typeof parsed.private_key === "string"
		);
	} catch {
		return false;
	}
}

function failureMessage(cause: unknown): SettingsMessage {
	if (typeof cause !== "object" || cause === null) return "store.errorUnknown";
	if ("code" in cause && cause.code === "billing_credential_copy_failed")
		return "store.errorBillingCopy";
	if ("status" in cause && (cause.status === 400 || cause.status === 422))
		return "store.errorRejected";
	return "store.errorUnknown";
}
