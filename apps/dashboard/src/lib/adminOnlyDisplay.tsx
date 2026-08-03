"use client";
import { ADMIN_ROLE, OWNER_ROLE } from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";

import React from "react";

const AdminOnlyDisplay = ({ children }: { children: React.ReactNode }) => {
  const { selectedInstance } = useProjectSelection();
  const role = selectedInstance?.role;

  if (role !== OWNER_ROLE && role !== ADMIN_ROLE) return null;

  return <>{children}</>;
};

export default AdminOnlyDisplay;
