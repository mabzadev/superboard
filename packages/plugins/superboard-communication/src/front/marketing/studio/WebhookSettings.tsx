import { useId } from "react";

import { EmailEventWebhooks } from "../../email/components/modules/EmailDeveloperSettings.js";
import { useStudioI18n } from "./i18n.js";
import { ProviderWebhooks } from "./ProviderWebhooks.js";

export function WebhookSettings({ project }: { project: string }) {
	const { t } = useStudioI18n();
	const heading = useId();
	return (
		<section aria-labelledby={heading} className="space-y-6">
			<div className="space-y-1">
				<h2 id={heading} className="text-base font-semibold">
					{t("Webhooks")}
				</h2>
				<p className="text-sm text-kumo-subtle">
					{t("Delivery events come in from your email provider and go out to your own systems.")}
				</p>
			</div>
			<ProviderWebhooks project={project} />
			<EmailEventWebhooks project={project} />
		</section>
	);
}
