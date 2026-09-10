import { Button } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";

export const PreviewOnlyButton = ({
	htmlMessage,
	onPreview,
}: {
	htmlMessage: string | null;
	onPreview: (html: string) => void;
}) => {
	const handlePreview = () => {
		if (htmlMessage) {
			onPreview(htmlMessage);
		}
	};

	return (
		<Button variant={"secondary"} onClick={handlePreview}>
			Preview
		</Button>
	);
};
