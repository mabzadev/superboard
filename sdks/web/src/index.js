import { SuperBoardClient, SuperBoardError } from "./client.js";
import SuperBoard from "./superboard.js";

export {
	SUPERBOARD_SUPPORT_REALTIME_PATH,
	SUPERBOARD_SUPPORT_WIDGET_PATH,
	SuperBoardSupportClient,
	SuperBoardSupportException,
	SuperBoardSupportRealtime,
	SuperBoardSupportWidget,
} from "./support/index.js";
export default SuperBoard;

export { SuperBoardClient, SuperBoardError };
