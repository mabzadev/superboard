export const captchaRequired = "captcha_required";

export const captchaFields = (token: string | null) =>
	token ? { "cf-turnstile-response": token } : {};
