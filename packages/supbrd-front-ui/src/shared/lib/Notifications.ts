import { toast } from "sonner";

import { componentI18n } from "./component-i18n.js";

const pageI18n = () =>
	componentI18n(typeof document === "undefined" ? undefined : document.documentElement.lang);

export const showGenericError = (): void => {
	toast.error(pageI18n()("notification.genericError"));
};

export const showSuccessNotification = (message: string): void => {
	toast.success(message);
};

export const showExportNotification = (): void => {
	toast.success(pageI18n()("notification.export"), { duration: 10000 });
};

export const showErrorNotification = (message: string): void => {
	toast.error(message);
};

export const showErrorNotificationWithLink = (message: string, onSuccess: () => void): void => {
	toast.error(message, {
		action: {
			label: pageI18n()("notification.view"),
			onClick: onSuccess,
		},
	});
};
