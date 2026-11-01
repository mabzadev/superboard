import CommunicationWorkspace from "../marketing/studio/CommunicationWorkspace.js";
export default function View() {
	return <CommunicationWorkspace initialTab="emails" emailFilter="transactional" />;
}
