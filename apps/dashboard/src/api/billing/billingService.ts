import { GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

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
  credentials?: {
    ios: {
      configured: boolean;
      key_id?: string | null;
      app_apple_id?: string | null;
      bundle_id?: string | null;
      filename?: string | null;
    };
    android: {
      configured: boolean;
      client_email?: string | null;
      project_id?: string | null;
      package_name?: string | null;
      filename?: string | null;
    };
  };
}

export const getBillingOverview = async (projectId: string): Promise<BillingOverview> =>
  (await GET(config.apiPath + `/billing/${projectId}`)).data;

export const updateBillingSettings = async (projectId: string, data: { purchases_enabled: boolean; restore_behavior: string }) =>
  (await PUT(config.apiPath + `/billing/${projectId}/settings`, data)).data;

export const createEntitlement = async (projectId: string, data: { identifier: string; display_name: string }) =>
  (await POST(config.apiPath + `/billing/${projectId}/entitlements`, data)).data;

export const createProduct = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/products`, data)).data;

export interface BillingStoreSyncResult {
  stores: Array<{
    ok: boolean;
    platform: "ios" | "android";
    store: "apple" | "google";
    imported?: number;
    error?: string;
  }>;
}

export const syncBillingProducts = async (projectId: string): Promise<BillingStoreSyncResult> =>
  (await POST(config.apiPath + `/billing/${projectId}/products/sync`, {})).data;

export const createOffering = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/offerings`, data)).data;

export const createBillingPackage = async (projectId: string, offeringId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/offerings/${offeringId}/packages`, data)).data;

export const searchBillingCustomers = async (projectId: string, query: string) =>
  (await GET(config.apiPath + `/billing/${projectId}/customers?q=${encodeURIComponent(query)}`)).data;

export const testBillingCredentials = async (projectId: string, platform: "ios" | "android") =>
  (await POST(config.apiPath + `/billing/${projectId}/credentials/test`, { platform })).data;
