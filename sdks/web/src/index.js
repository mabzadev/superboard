import { SuperBoardClient, SuperBoardError } from "./client.js";
import SuperBoard from "./superboard.js";
import {
	SUPERBOARD_SUPPORT_REALTIME_PATH,
	SUPERBOARD_SUPPORT_WIDGET_PATH,
	SuperBoardSupportClient,
	SuperBoardSupportException,
	SuperBoardSupportRealtime,
	SuperBoardSupportWidget,
} from "./support/index.js";

// Keep the CommonJS/browser default callable while making the native Support
// API available as named ESM exports and static properties on the historical
// default export.
Object.defineProperties(SuperBoard, {
	SuperBoardClient: { value: SuperBoardClient, enumerable: true },
	SuperBoardError: { value: SuperBoardError, enumerable: true },
	SuperBoardSupportClient: { value: SuperBoardSupportClient, enumerable: true },
	SuperBoardSupportException: {
		value: SuperBoardSupportException,
		enumerable: true,
	},
	SuperBoardSupportRealtime: {
		value: SuperBoardSupportRealtime,
		enumerable: true,
	},
	SuperBoardSupportWidget: { value: SuperBoardSupportWidget, enumerable: true },
});

export {
	SUPERBOARD_SUPPORT_REALTIME_PATH,
	SUPERBOARD_SUPPORT_WIDGET_PATH,
	SuperBoardSupportClient,
	SuperBoardSupportException,
	SuperBoardSupportRealtime,
	SuperBoardSupportWidget,
};
export default SuperBoard;

export { SuperBoardClient, SuperBoardError };
