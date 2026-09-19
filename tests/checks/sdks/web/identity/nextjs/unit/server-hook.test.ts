import { expect, it } from "vitest";

import {
	getCachedServerSession,
	getNextAuth,
} from "../../../../../../../sdks/web/identity/nextjs/src/hooks/getNextAuth";

it("loads server authentication hooks with the installed React runtime", () => {
	expect(getCachedServerSession).toBeTypeOf("function");
	expect(getNextAuth).toBeTypeOf("function");
});
