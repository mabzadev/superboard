import OpenGrow from "./opengrow.js";
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
Object.defineProperties(OpenGrow, {
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
export default OpenGrow;
