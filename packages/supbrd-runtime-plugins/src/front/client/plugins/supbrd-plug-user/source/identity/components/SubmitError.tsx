import { errorSignal } from "../signals/index.js";
import useSignalValue from "../useSignalValue.js";
import { Alert } from "./ui/alert.js";

const SubmitError = () => {
	const error = useSignalValue(errorSignal);

	if (!error) return null;

	return (
		<Alert variant="destructive" className="mt-6">
			{error}
		</Alert>
	);
};

export default SubmitError;
