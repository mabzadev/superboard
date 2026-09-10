import { useTranslations } from "next-intl";

import { Button } from "./ui/button.js";
import { Spinner } from "./ui/spinner.js";

const SaveButton = ({
	onClick,
	className,
	disabled = false,
	isLoading = false,
}: {
	onClick: () => void;
	className?: string;
	disabled?: boolean;
	isLoading?: boolean;
}) => {
	const t = useTranslations();

	return (
		<Button
			data-testid="saveButton"
			disabled={disabled || isLoading}
			className={className}
			onClick={onClick}
		>
			{t("common.save")}
			{isLoading && <Spinner className="ml-2" />}
		</Button>
	);
};

export default SaveButton;
