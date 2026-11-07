import type { Scope } from "../services/auth/api.js";
import SwitchRow from "./SwitchRow.js";

const ScopesEditor = ({
	scopes,
	value,
	onToggleScope,
	disabled,
}: {
	scopes: Scope[];
	value: string[];
	onToggleScope: (scope: string) => void;
	disabled?: boolean;
}) => {
	return (
		<section className="flex flex-col gap-3">
			{scopes.map((scope) => (
				<SwitchRow
					key={scope.id}
					data-testid="scopeInput"
					id={`scope-${scope.id}`}
					label={<span data-testid="scopeLabel">{scope.name}</span>}
					onClick={() => onToggleScope(scope.name)}
					checked={value?.includes(scope.name)}
					disabled={disabled}
				/>
			))}
		</section>
	);
};

export default ScopesEditor;
