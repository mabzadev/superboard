import { useLingui } from "@lingui/react/macro";

import { ArrowPrev } from "../ArrowIcons.js";
import { RouterLinkButton } from "../RouterLinkButton.js";

export function BackToSettingsLink() {
	const { t } = useLingui();
	return (
		<RouterLinkButton
			to="/settings"
			variant="ghost"
			shape="square"
			aria-label={t`Back to settings`}
			icon={<ArrowPrev />}
		/>
	);
}
