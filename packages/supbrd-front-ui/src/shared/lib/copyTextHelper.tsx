import { showSuccessNotification } from "./Notifications.js";

export const handleCopyText = (copyValue: string) => {
	navigator.clipboard.writeText(copyValue);
	showSuccessNotification("Copied to clipboard");
};
