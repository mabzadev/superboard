"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  Zap,
  Link,
  BarChart3,
  DollarSign,
  Users,
  Smartphone,
  MessageSquare,
  ArrowRight,
  Shield,
} from "lucide-react";
import { Button } from "../ui/button";
import { config } from "@/lib/config";

const ScaleUpDialog = ({
  open,
  onOpenChange,
  handleUpgrade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleUpgrade: () => void;
}) => {
  const benefits = [
    { icon: Link, title: "Unlimited Links", desc: "No caps on link creation" },
    { icon: Users, title: "Unlimited MAU", desc: "Scale to any audience size" },
    {
      icon: BarChart3,
      title: "Advanced Analytics",
      desc: "Full tracking & CSV exports",
    },
    {
      icon: DollarSign,
      title: "Revenue Attribution",
      desc: "Track purchases per link",
    },
    {
      icon: Smartphone,
      title: "All Platforms",
      desc: "iOS, Android & Web SDKs",
    },
    {
      icon: MessageSquare,
      title: "Marketing Messages",
      desc: "In-app & push messaging",
    },
    { icon: Shield, title: "SSO & Security", desc: "Single sign-on included" },
    { icon: Zap, title: "Priority Computing", desc: "Faster link resolution" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="scale-up-plan"
        className="flex flex-col w-full !max-w-[860px] gap-0 p-0 overflow-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Scale Up Plan</DialogTitle>
          <DialogDescription>Upgrade to the Scale Up plan</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left — Info */}
          <div className="flex flex-col justify-between w-[300px] shrink-0 px-8 py-12 border-r border-sidebar-border">
            <div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#FEE950] text-[#1A1A1B] text-[10px] font-bold uppercase tracking-widest">
                Most popular
              </span>

              <h3 className="text-2xl font-bold tracking-tight mt-4">
                Scale Up
              </h3>

              <div className="mt-5">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">
                    $1.99
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / 1k MAU
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  per month, billed monthly
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-8">
              <Button
                className="w-full h-11 text-sm font-semibold bg-foreground hover:bg-foreground/90 text-background"
                onClick={handleUpgrade}
              >
                <Zap className="h-4 w-4" />
                Get started for free
              </Button>
              <a
                href={`${config.pricingUrl}#calculator`}
                target="_blank"
                className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg text-xs font-medium border border-sidebar-border hover:bg-muted/80 transition-colors"
              >
                <DollarSign className="h-3.5 w-3.5" />
                Estimate cost
                <ArrowRight className="h-3 w-3" />
              </a>
              <span className="text-[11px] text-muted-foreground text-center">
                First 10k MAU free
              </span>
            </div>
          </div>

          {/* Right — Benefits grid */}
          <div className="flex-1 bg-muted/30 px-7 py-12 overflow-y-auto flex flex-col">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              What you get
            </span>
            <p className="text-sm text-muted-foreground mt-1.5 mb-5 leading-relaxed">
              The most scalable deep linking, attribution, and referral solution
              on the market.
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

export default ScaleUpDialog;
