import { EyeIcon, PencilSquareIcon } from "@heroicons/react/16/solid";

import { Link } from "../i18n/navigation.js";
import { Button } from "./ui/button.js";

const EditLink = ({ href, viewOnly }: { href: string; viewOnly?: boolean }) => {
	return (
		<Button className="w-10" asChild variant="outline" data-testid="editLink">
			<Link href={href}>
				{viewOnly ? <EyeIcon className="w-4 h-4" /> : <PencilSquareIcon className="w-4 h-4" />}
			</Link>
		</Button>
	);
};

export default EditLink;
