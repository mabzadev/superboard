export type AppleSubscriptionAvailability = {
  planCount: number;
  availableTerritoryCount: number;
  availableInNewTerritories: boolean;
};

export type GoogleBasePlanReadiness = {
  basePlanId: string | null;
  state: string | null;
  billingPeriod: string | null;
  availableRegionCount: number;
  availableInOtherRegions: boolean;
  newSubscriberAvailable: boolean;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseAppleSubscriptionAvailability(payload: Record<string, unknown>): AppleSubscriptionAvailability {
  const plans = Array.isArray(payload.data) ? payload.data.map(objectValue) : [];
  const included = Array.isArray(payload.included) ? payload.included.map(objectValue) : [];
  return {
    planCount: plans.length,
    availableTerritoryCount: included.filter((resource) => resource.type === 'territories').length,
    availableInNewTerritories: plans.some((plan) => objectValue(plan.attributes).availableInNewTerritories === true),
  };
}

export function googleBasePlanReadiness(plan: Record<string, unknown>): GoogleBasePlanReadiness {
  const autoRenewing = objectValue(plan.autoRenewingBasePlanType);
  const prepaid = objectValue(plan.prepaidBasePlanType);
  const installments = objectValue(plan.installmentsBasePlanType);
  const regionalConfigs = Array.isArray(plan.regionalConfigs)
    ? plan.regionalConfigs.map(objectValue)
    : [];
  const availableRegionCount = regionalConfigs.filter((region) => region.newSubscriberAvailability === true).length;
  const availableInOtherRegions = objectValue(plan.otherRegionsConfig).newSubscriberAvailability === true;
  return {
    basePlanId: plan.basePlanId ? String(plan.basePlanId) : null,
    state: plan.state ? String(plan.state) : null,
    billingPeriod: String(
      autoRenewing.billingPeriodDuration
      || prepaid.billingPeriodDuration
      || installments.billingPeriodDuration
      || '',
    ) || null,
    availableRegionCount,
    availableInOtherRegions,
    newSubscriberAvailable: availableRegionCount > 0 || availableInOtherRegions,
  };
}
