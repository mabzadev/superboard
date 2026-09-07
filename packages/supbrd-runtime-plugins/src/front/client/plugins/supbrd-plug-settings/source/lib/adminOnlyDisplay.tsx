"use client";
import React from "react";

import {
	ADMIN_ROLE,
	OWNER_ROLE,
} from "../../../../../../../../supbrd-front-ui/src/shared/constants/OptionsConstants.js";
import { useProjectSelection } from "../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";

const AdminOnlyDisplay = ({ children }: { children: React.ReactNode }) => {
	const { selectedInstance } = useProjectSelection();
	const role = selectedInstance?.role;

	if (role !== OWNER_ROLE && role !== ADMIN_ROLE) return null;

	return <>{children}</>;
};

export default AdminOnlyDisplay;
