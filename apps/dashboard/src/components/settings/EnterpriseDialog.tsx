"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  ArrowRight,
  Globe,
  ShieldCheck,
  HeadphonesIcon,
  FileText,
  Server,
  Users,
  Lock,
  BarChart3,
} from "lucide-react";
import { Button } from "../ui/button";
import { config } from "@/lib/config";

const EnterpriseDialog = ({
  open,
  onOpenChange,
  handleUpgrade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleUpgrade: () => void;
}) => {
  const benefits = [
    {
      icon: Globe,
      title: "Custom Domains",
      desc: "White-label links with your brand",
    },
    {
      icon: ShieldCheck,
      title: "Audit Logs",
      desc: "Full visibility into team activity",
    },
    {
      icon: HeadphonesIcon,
      title: "Dedicated CSM",
      desc: "Your own success manager",
    },
    {
      icon: FileText,
      title: "Custom Billing",
      desc: "Flexible invoicing & terms",
    },
    {
      icon: Server,
      title: "Self-Hosted Option",
      desc: "Deploy on your infrastructure",
    },
    {
      icon: Users,
      title: "Migration Support",
      desc: "Seamless platform onboarding",
    },
    {
      icon: Lock,
      title: "SLA Guarantees",
      desc: "Contractual uptime commitments",
    },
    {
      icon: BarChart3,
      title: "Advanced Reporting",
      desc: "Custom dashboards & exports",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="enterprise-plan"
        className="flex flex-col w-full !max-w-[860px] gap-0 p-0 overflow-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Enterprise Plan</DialogTitle>
          <DialogDescription>Learn about the Enterprise plan</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left — Info */}
          <div className="flex flex-col justify-between w-[300px] shrink-0 px-8 py-12 border-r border-sidebar-border">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">Enterprise</h3>

              <div className="mt-5">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">
                    Custom
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  starting from 500,000 MAU
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-8">
              <Button
                className="w-full h-11 text-sm font-semibold bg-foreground hover:bg-foreground/90 text-background"
                onClick={handleUpgrade}
              >
                Contact Sales
                <ArrowRight className="h-4 w-4" />
              </Button>
              <a
                href={`${config.pricingUrl}#calculator`}
                target="_blank"
                className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg text-xs font-medium border border-sidebar-border hover:bg-muted/80 transition-colors"
              >
                Compare plans
                <ArrowRight className="h-3 w-3" />
              </a>
              <span className="text-[11px] text-muted-foreground text-center">
                Custom pricing
              </span>
            </div>
          </div>

          {/* Right — Benefits grid */}
          <div className="flex-1 bg-muted/30 px-7 py-12 overflow-y-auto flex flex-col">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Enterprise benefits
            </span>
            <p className="text-sm text-muted-foreground mt-1.5 mb-5 leading-relaxed">
              For companies requiring advanced compliance, dedicated support,
              and custom infrastructure.
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {benefits.map((item, index) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-background border border-sidebar-border shadow-[0_1px_3px_0_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_0_rgba(0,0,0,0.08)] transition-shadow animate-fade-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-foreground/[0.05] shrink-0">
                    <item.icon className="h-4 w-4 text-foreground/70" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13px] font-semibold leading-tight">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-snug">
                      {item.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <a
              href={`${config.pricingUrl}#features`}
              target="_blank"
              className="inline-flex items-center gap-1.5 mt-5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              See all features
              <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EnterpriseDialog;
