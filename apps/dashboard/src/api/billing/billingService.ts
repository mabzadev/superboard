import { GET, POST, PUT } from "@/lib/api";

export interface BillingProduct {
  id: string;
  store: "apple" | "google";
  store_product_id: string;
  product_type: string;
  display_name: string;
  environment: string;
  active: number;
}

export interface BillingEntitlement {
  id: string;
  identifier: string;
  display_name: string;
  active: number;
}

export interface BillingOffering {
  id: string;
  identifier: string;
  display_name: string;
  is_current: number;
}

export interface BillingOverview {
  settings?: { purchases_enabled: number; restore_behavior: string };
  products: BillingProduct[];
  entitlements: BillingEntitlement[];
  offerings: BillingOffering[];
  metrics?: { revenue_micros: number; paying_customers: number; trials: number; refunds: number };
}

export const getBillingOverview = async (projectId: string): Promise<BillingOverview> =>
  (await GET(`/billing/${projectId}`)).data;

export const updateBillingSettings = async (projectId: string, data: { purchases_enabled: boolean; restore_behavior: string }) =>
  (await PUT(`/billing/${projectId}/settings`, data)).data;

export const createEntitlement = async (projectId: string, data: { identifier: string; display_name: string }) =>
  (await POST(`/billing/${projectId}/entitlements`, data)).data;

export const createProduct = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(`/billing/${projectId}/products`, data)).data;

export const createOffering = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(`/billing/${projectId}/offerings`, data)).data;

export const createBillingPackage = async (projectId: string, offeringId: string, data: Record<string, unknown>) =>
  (await POST(`/billing/${projectId}/offerings/${offeringId}/packages`, data)).data;

export const searchBillingCustomers = async (projectId: string, query: string) =>
  (await GET(`/billing/${projectId}/customers?q=${encodeURIComponent(query)}`)).data;

export const testBillingCredentials = async (projectId: string, platform: "ios" | "android") =>
  (await POST(`/billing/${projectId}/credentials/test`, { platform })).data;
