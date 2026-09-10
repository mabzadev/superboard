import { expect, test } from "vitest";

import { requestGeolocation } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/request-geolocation.js";

test("missing Cloudflare metadata remains unknown for service-binding requests", () => {
	expect(requestGeolocation({})).toBeNull();
	expect(requestGeolocation({ cf: undefined })).toBeNull();
	expect(requestGeolocation({ cf: null })).toBeNull();
});
test("only supplied geolocation fields are recorded, without invented zero coordinates", () => {
	const detail = requestGeolocation({
		cf: { country: "CH", timezone: "Europe/Zurich", colo: "ZRH" },
	});
	expect(JSON.parse(detail!)).toEqual({ country: "CH", timezone: "Europe/Zurich" });
});
