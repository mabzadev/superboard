import { useState } from "react";
import { Button } from "../ui/button";
import { Building, Crown, ExternalLink, Star, Zap } from "lucide-react";
import { Progress } from "../ui/progress";
import ScaleUpDialog from "./ScaleUpDialog";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification } from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import EnterpriseDialog from "./EnterpriseDialog";
import { formatMediumDate } from "@/lib/dateUtils";
import { Skeleton } from "../ui/skeleton";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import {
  useSubscriptionQuery,
  useMauQuery,
} from "@/hooks/queries/usePaymentsQueries";
import {
  useCreateSubscriptionMutation,
  useCancelSubscriptionMutation,
} from "@/hooks/mutations/usePaymentsMutations";
import { getDashboardUrlAPICall } from "@/api/payments/paymentsService";

const PlanSection = () => {
  const { selectedInstance } = useProjectSelection();
  const subscriptionQuery = useSubscriptionQuery(selectedInstance?.id);
  const subscription = subscriptionQuery.data?.subscription ?? null;
  const isEnterprise = subscriptionQuery.data?.isEnterprise ?? false;
  const planLoaded =
    !subscriptionQuery.isLoading && subscriptionQuery.isFetched;

  const mauQuery = useMauQuery(selectedInstance?.id);
  const mau = mauQuery.data ?? { current_quantity: 0, total_available: 1 };

  const createSubscriptionMutation = useCreateSubscriptionMutation(
    selectedInstance?.id
  );
  const cancelSubscriptionMutation = useCancelSubscriptionMutation(
    selectedInstance?.id
  );

  const [scaleUpOpen, setScaleUpOpen] = useState<boolean>(false);
  const [enterpriseOpen, setEnterpriseOpen] = useState<boolean>(false);

  const percentage = (current: number, total: number) => {
    return (current / total) * 100;
  };

  const handleCancelSubscription = async () => {
    try {
      await cancelSubscriptionMutation.mutateAsync();
      // Refetch subscription after a delay to let Stripe process
      setTimeout(() => {
        subscriptionQuery.refetch();
      }, 2500);
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleUpgradeSubscription = async () => {
    try {
      const response = await createSubscriptionMutation.mutateAsync();
      const link = response.data.url;
      window.location.href = link;
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleGoToStripDetails = async () => {
    if (!selectedInstance) return;

    try {
      const response = await getDashboardUrlAPICall(selectedInstance.id);
      const url = response.data.url;

      window.open(url);
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleUpgradeEnterprise = () => {
    window.open(config.salesUrl, "_blank");
  };

  const getCurrentMauValue = () => {
    if (subscription) {
      if (isEnterprise) {
        return subscription.current_maus;
      } else {
        return subscription.maus;
      }
    } else {
      return mau.current_quantity;
    }
  };

  const getCurrentTotalMauValue = () => {
    if (subscription) {
      if (isEnterprise) {
        return subscription.total_maus;
      } else {
        return subscription.maus;
      }
    } else {
      return mau.total_available;
    }
  };

  const numberFormatter = new Intl.NumberFormat("de-DE");

  const getPlanName = () => {
    if (!subscription) return "Free";
    if (isEnterprise) return "Enterprise";
    return "Scale Up";
  };

  const getPlanIcon = () => {
    if (!subscription) return Zap;
    if (isEnterprise) return Building;
    return Crown;
  };

  const getStartDate = () => {
    if (!subscription) return null;
    if (isEnterprise) return formatMediumDate(subscription.start_at);
    return formatMediumDate(
      subscription.stripe_subscription.current_period_start * 1000
    );
  };

  const getEndDate = () => {
    if (!subscription) return null;
    if (isEnterprise) return formatMediumDate(subscription.end_at);
    return formatMediumDate(
      subscription.stripe_subscription.current_period_end * 1000
    );
  };

  const mauOverLimit = () => {
    if (subscription && !isEnterprise) return false;
    return getCurrentTotalMauValue() - getCurrentMauValue() < 0;
  };

  const PlanIcon = getPlanIcon();

  if (!planLoaded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Plan & Billing</span>
          <span className="text-xs text-muted-foreground">
            Manage your subscription and monitor usage.
          </span>
        </div>
        <div className="rounded-xl border border-sidebar-border overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-3 w-[180px]" />
              </div>
            </div>
          </div>
          <div className="border-t border-sidebar-border px-5 py-4">
            <Skeleton className="h-1.5 w-full rounded-full" />
            <div className="flex justify-between mt-2">
              <Skeleton className="h-3 w-[120px]" />
              <Skeleton className="h-3 w-[80px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">Plan & Billing</span>
        <span className="text-xs text-muted-foreground">
          Manage your subscription and monitor usage.
        </span>
      </div>

      {/* Plan card */}
      <div
        className={cn(
          "rounded-xl border overflow-hidden",
          !subscription
            ? "border-sidebar-border"
            : isEnterprise
              ? "border-chart-2/30"
              : "border-primary/30"
        )}
      >
        {/* Plan tier + actions */}
        <div
          className={cn(
            "px-5 py-5 flex items-center gap-4",
            !subscription
              ? "bg-muted/50"
              : isEnterprise
                ? "bg-gradient-to-r from-chart-2/8 to-chart-2/3"
                : "bg-gradient-to-r from-primary/8 to-primary/3"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center h-11 w-11 rounded-xl shrink-0",
              !subscription
                ? "bg-background border border-sidebar-border shadow-sm"
                : isEnterprise
                  ? "bg-chart-2/15 ring-1 ring-chart-2/20"
                  : "bg-primary/15 ring-1 ring-primary/20"
            )}
          >
            <PlanIcon
              className={cn(
                "h-5 w-5",
                !subscription
                  ? "text-muted-foreground"
                  : isEnterprise
                    ? "text-chart-2"
                    : "text-primary"
              )}
            />
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-lg font-semibold tracking-tight">
              {getPlanName()}
            </span>
            <span className="text-xs text-muted-foreground">
              {subscription
                ? `${getStartDate()} — ${getEndDate()}`
                : "Free tier with limited monthly active users."}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!subscription ? (
              <>
                <Button size="sm" onClick={() => setScaleUpOpen(true)}>
                  <Star className="h-3.5 w-3.5" />
                  Upgrade
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEnterpriseOpen(true)}
                >
                  Enterprise
                </Button>
              </>
            ) : !isEnterprise ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGoToStripDetails()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Manage Billing
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={handleCancelSubscription}
                >
                  Cancel Plan
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Usage */}
        <div className="border-t border-sidebar-border px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground">
              Monthly Active Users
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  mauOverLimit() ? "text-destructive" : "text-foreground"
                )}
              >
                {numberFormatter.format(getCurrentMauValue())}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                / {numberFormatter.format(getCurrentTotalMauValue())}
              </span>
            </div>
          </div>
          <Progress
            value={Math.min(
              percentage(getCurrentMauValue(), getCurrentTotalMauValue()),
              100
            )}
            className="h-1.5"
            indicatorClassName={cn(
              mauOverLimit() ? "bg-destructive" : "bg-valid-green"
            )}
          />
          <div className="flex items-center justify-between mt-2">
            {mauOverLimit() ? (
              <span className="text-xs text-destructive font-medium">
                Over limit by{" "}
                {numberFormatter.format(
                  Math.abs(getCurrentTotalMauValue() - getCurrentMauValue())
                )}{" "}
                — upgrade to continue.
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {numberFormatter.format(
                  getCurrentTotalMauValue() - getCurrentMauValue()
                )}{" "}
                remaining this period
              </span>
            )}
            <a
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/marketing/maus`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Learn more
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Stripe billing breakdown */}
        {subscription && !isEnterprise && (
          <div className="border-t border-sidebar-border">
            <div className="grid grid-cols-3 divide-x divide-sidebar-border">
              <div className="px-5 py-4 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Total MAUs
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {numberFormatter.format(subscription?.maus)}
                </span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Billed MAUs
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {numberFormatter.format(
                    subscription?.quantity_for_current_billing_cycle
                  )}
                </span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Current Period
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrencyFromCents(subscription?.amount_cents)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <ScaleUpDialog
        open={scaleUpOpen}
        onOpenChange={setScaleUpOpen}
        handleUpgrade={handleUpgradeSubscription}
      />
      <EnterpriseDialog
        open={enterpriseOpen}
        onOpenChange={setEnterpriseOpen}
        handleUpgrade={handleUpgradeEnterprise}
      />
    </div>
  );
};

export default PlanSection;
