import { getByText, fireEvent, queryByText } from "@testing-library/dom";
import { render } from "hono/jsx/dom";
import { expect, describe, it, vi, beforeEach, Mock } from "vitest";

import { MfaType } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/models/user";
import MfaEnroll, {
	MfaEnrollProps,
} from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/blocks/MfaEnroll";
import { mfaEnroll } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/tools/locale";

// Fake mfaEnrollInfo for testing
const fakeMfaEnrollInfo = { mfaTypes: ["email", "sms"] as MfaType[] };

describe("MfaEnroll Component", () => {
	const defaultProps: MfaEnrollProps = {
		locale: "en" as any,
		mfaEnrollInfo: fakeMfaEnrollInfo,
		onEnroll: vi.fn(),
		submitError: null,
		isEnrolling: false,
	};

	const setup = (props: MfaEnrollProps = defaultProps) => {
		const container = document.createElement("div");
		render(<MfaEnroll {...props} />, container);
		document.body.appendChild(container);
		return container;
	};

	beforeEach(() => {
		(defaultProps.onEnroll as Mock).mockReset();
	});

	it("renders view title correctly", () => {
		const container = setup();
		const titleElement = getByText(container, mfaEnroll.title.en);
		expect(titleElement).toBeDefined();
	});

	it("renders secondary buttons for each MFA type when info is provided", () => {
		const container = setup();
		const emailButton = getByText(container, mfaEnroll.email.en);
		const smsButton = getByText(container, mfaEnroll.sms.en);
		expect(emailButton).toBeDefined();
		expect(smsButton).toBeDefined();
	});

	it("calls handleEnroll with correct MFA type when a secondary button is clicked", () => {
		const container = setup();
		const emailButton = getByText(container, mfaEnroll.email.en);
		fireEvent.click(emailButton);
		expect(defaultProps.onEnroll).toHaveBeenCalledWith("email");
	});

	it("renders no secondary buttons when mfaEnrollInfo is null", () => {
		const props = {
			...defaultProps,
			mfaEnrollInfo: null,
		};
		const container = setup(props);
		const emailButton = queryByText(container, mfaEnroll.email.en);
		const smsButton = queryByText(container, mfaEnroll.sms.en);
		expect(emailButton).toBeNull();
		expect(smsButton).toBeNull();
	});

	it("renders submit error message when submitError is provided", () => {
		const errorMessage = "Test Error";
		const props = {
			...defaultProps,
			submitError: errorMessage,
		};
		const container = setup(props);
		expect(container.textContent).toContain(errorMessage);
	});
});
