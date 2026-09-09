import type { EmailDesign } from "@superboard/contracts/email-studio";
import {
	simulateJourney,
	type JourneySimulationStep,
} from "@superboard/contracts/journey-simulation";
import { Button, Checkbox, Input, InputArea } from "@superboard/front-ui/kumo";
import { useRef, useState } from "react";

import type { EmailTemplate, JourneyDefinition } from "../source/api/marketing/marketingService.js";
import { useStudioI18n } from "./i18n.js";
import { getPublishedStudioTemplate } from "./service.js";

export function JourneySimulation({
	project,
	definition,
	templates,
}: {
	project: string;
	definition: JourneyDefinition;
	templates: EmailTemplate[];
}) {
	const { t, locale } = useStudioI18n();
	const [profile, setProfile] = useState({
		name: "Alex",
		email: "alex@example.test",
		locale,
		plan: "free",
		consented: true,
	});
	const [attributes, setAttributes] = useState("{}");
	const [signal, setSignal] = useState("{}");
	const [steps, setSteps] = useState<JourneySimulationStep[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const current = useRef("");
	current.current = JSON.stringify([definition, profile, attributes, signal]);
	const run = async () => {
		setBusy(true);
		setError("");
		const signature = current.current;
		try {
			const extra: unknown = JSON.parse(attributes);
			const event: unknown = JSON.parse(signal);
			if (
				!extra ||
				typeof extra !== "object" ||
				Array.isArray(extra) ||
				!event ||
				typeof event !== "object" ||
				Array.isArray(event)
			)
				throw new Error();
			const messages: Record<string, { published: boolean; document?: EmailDesign }> = {};
			for (const id of new Set(
				definition.nodes
					.filter((node) => node.type === "email")
					.map((node) => node.template_id ?? ""),
			)) {
				const template = templates.find((item) => item.id === id);
				if (!template) {
					messages[id] = { published: false };
					continue;
				}
				if (!template.studio_document) {
					messages[id] = { published: true };
					continue;
				}
				const published = await getPublishedStudioTemplate(project, id);
				messages[id] = published
					? { published: true, document: published.document }
					: { published: false };
			}
			const result = simulateJourney(
				definition,
				{
					subscriber: {
						name: profile.name,
						email: profile.email,
						status: "enabled",
						consent_status: profile.consented ? "confirmed" : "revoked",
						attributes: { locale: profile.locale, plan: profile.plan, ...extra },
					},
					signal: { properties: event },
				},
				messages,
			);
			if (current.current === signature) setSteps(result);
			else setError(t("The scenario changed. Run the simulation again."));
		} catch {
			setError(t("Check the test values and published templates."));
		} finally {
			setBusy(false);
		}
	};
	return (
		<details className="rounded-xl border border-kumo-line bg-kumo-base p-4">
			<summary className="cursor-pointer font-semibold">{t("Simulate journey")}</summary>
			<div className="mt-4 space-y-4">
				<p className="text-sm text-kumo-subtle">{t("Simulation never sends a message.")}</p>
				<div className="grid gap-3 md:grid-cols-4">
					{(["name", "email", "locale", "plan"] as const).map((key) => (
						<Input
							key={key}
							label={t(key)}
							value={profile[key]}
							onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
						/>
					))}
				</div>
				<Checkbox
					label={t("Marketing consent")}
					checked={profile.consented}
					onCheckedChange={(value) => setProfile({ ...profile, consented: value === true })}
				/>
				<details>
					<summary>{t("Additional test values")}</summary>
					<div className="mt-3 grid gap-3 md:grid-cols-2">
						<InputArea
							label={t("Profile attributes")}
							value={attributes}
							onChange={(event) => setAttributes(event.target.value)}
						/>
						<InputArea
							label={t("Event properties")}
							value={signal}
							onChange={(event) => setSignal(event.target.value)}
						/>
					</div>
				</details>
				<Button variant="primary" loading={busy} onClick={() => void run()}>
					{t("Run simulation")}
				</Button>
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{steps.length > 0 && (
					<div className="overflow-auto">
						<table className="w-full text-start text-sm">
							<thead>
								<tr>
									{["Step", "Scheduled", "Outcome", "Language"].map((key) => (
										<th key={key} className="p-3 text-start">
											{t(key)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{steps.map((step, index) => (
									<tr key={step.id + index} className="border-t border-kumo-line">
										<td className="p-3">{t(step.type)}</td>
										<td>{new Date(step.at).toLocaleString(locale)}</td>
										<td>{t(step.reason ?? step.outcome)}</td>
										<td>{step.locale ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</details>
	);
}
