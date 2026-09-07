import { useRef, type ReactNode } from "react";

import { useFrontContext } from "../../context.js";

export function useUserContext() {
	const { operator } = useFrontContext();
	const userRef = useRef(operator);
	userRef.current = operator;
	return { user: operator, userRef, currentUser: () => operator, isHydrated: true };
}

export default function UserContextProvider({ children }: { children: ReactNode }) {
	return children;
}
