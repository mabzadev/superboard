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

export const showErrorNotification = (message: string): void => {
	toast.error(message);
};
