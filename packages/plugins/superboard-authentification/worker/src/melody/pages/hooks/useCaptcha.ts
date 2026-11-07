import { useCallback, useState } from "hono/jsx";

const useCaptcha = () => {
	const [token, setToken] = useState<string | null>(null);
	const [resetCount, setResetCount] = useState(0);
	const reset = useCallback(() => {
		setResetCount((count) => count + 1);
	}, []);
	return { token, setToken, resetCount, reset };
};

export default useCaptcha;
