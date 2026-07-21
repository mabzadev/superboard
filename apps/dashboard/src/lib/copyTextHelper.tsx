import { showSuccessNotification } from "./Notifications";

export const handleCopyText = (copyValue: string) => {
  navigator.clipboard.writeText(copyValue);
  showSuccessNotification("Copied to clipboard");
};
