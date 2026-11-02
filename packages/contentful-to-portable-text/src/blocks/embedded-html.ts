import type { ArbitraryTypedObject } from "@portabletext/types";

import { getStringField } from "../types.js";
import type { ContentfulEntry } from "../types.js";

export function transformEmbeddedHtml(entry: ContentfulEntry, key: string): ArbitraryTypedObject {
	return {
		_type: "htmlBlock",
		_key: key,
		html: getStringField(entry.fields, "customHtml") ?? "",
	};
}
