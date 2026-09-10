import Page from "../app/(protected)/project-settings/page.js";
import InstanceConfiguration from "../InstanceConfiguration.js";
export default function View() {
	return (
		<>
			<InstanceConfiguration />
			<Page />
		</>
	);
}
