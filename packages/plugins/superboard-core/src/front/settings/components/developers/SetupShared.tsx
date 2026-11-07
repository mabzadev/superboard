"use client";

import { cn } from "@superboard/front-ui/lib/utils.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Progress } from "@superboard/front-ui/ui/progress.js";
import { Check, ChevronLeft, ChevronRight, Circle, Save } from "lucide-react";
import React, { lazy, Suspense, useCallback, useRef } from "react";

import { useSdkI18n } from "../../sdk-i18n.js";

function useNativeClick(handler: (() => void) | undefined) {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const listenerRef = useRef<(e: Event) => void>(null!);
	if (!listenerRef.current) {
		listenerRef.current = (e: Event) => {
			e.stopPropagation();
			handlerRef.current?.();
		};
	}

	const elRef = useRef<HTMLButtonElement | null>(null);

	const setRef = useCallback((el: HTMLButtonElement | null) => {
		const listener = listenerRef.current!;
		if (elRef.current) {
			elRef.current.removeEventListener("click", listener);
		}
		if (el) {
			el.addEventListener("click", listener);
		}
		elRef.current = el;
	}, []);

	return setRef;
}

export type StepDef = {
	name: string;
	icon: React.ComponentType<{ className?: string }>;
	optional: boolean;
};

export type CodeBlockData = {
	language: string;
	filename: string;
	code: string;
	highlightLines?: number[];
};

const CodeBlockView = lazy(() => import("./RenderCodeBlock.js"));

export function RenderCodeBlock({ data }: { data: CodeBlockData[] }) {
	return (
		<Suspense
			fallback={
				<div className="size-full overflow-auto rounded-md border">
					<pre className="w-full p-4 text-sm">
						<code>{data[0]?.code}</code>
					</pre>
				</div>
			}
		>
			<CodeBlockView data={data} />
		</Suspense>
	);
}

export function SectionHeader({
	icon: Icon,
	title,
	subtitle,
	badge,
	action,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	subtitle: string;
	badge?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-3">
			<div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
				<Icon className="h-5 w-5 text-muted-foreground" />
			</div>
			<div className="flex flex-col gap-0.5 flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">{title}</span>
					{badge}
				</div>
				<span className="text-xs text-muted-foreground leading-snug">{subtitle}</span>
			</div>
			{action}
		</div>
	);
}

export function OverviewRow({
	title,
	description,
	configured,
	action,
}: {
	title: string;
	description: string;
	configured: boolean;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<div
				className={cn(
					"flex items-center justify-center h-7 w-7 rounded-lg shrink-0",
					configured ? "bg-valid-green-light-2 text-valid-green" : "bg-muted text-muted-foreground",
				)}
			>
				{configured ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
			</div>
			<div className="flex flex-col flex-1 min-w-0">
				<span className="text-sm font-medium">{title}</span>
				<span className="text-xs text-muted-foreground">{description}</span>
			</div>
			{action}
		</div>
	);
}

export function WizardSidebar({
	platformLabel,
	steps,
	currentStep,
	visitedSteps,
	stepCompleted,
	sdkConfigured,
	onStepClick,
	onOverview,
}: {
	platformLabel: string;
	steps: readonly StepDef[];
	currentStep: number;
	visitedSteps: Set<number>;
	stepCompleted: boolean[];
	sdkConfigured: boolean;
	onStepClick: (step: number) => void;
	onOverview: () => void;
}) {
	const { t } = useSdkI18n();
	const completedCount = stepCompleted.filter(Boolean).length;
	const progressPercent = Math.round((completedCount / steps.length) * 100);

	return (
		<div className="w-[280px] shrink-0 bg-sidebar/50 border-e border-sidebar-border flex flex-col">
			<div className="px-4 pt-5 pb-4 flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{platformLabel}
					</span>
					<span className="text-xs text-muted-foreground">
						{t("sidebar.complete", { count: completedCount, total: steps.length })}
					</span>
				</div>
				<Progress value={progressPercent} className="h-1.5" indicatorClassName="bg-valid-green" />
			</div>

			<div className="flex-1 overflow-auto px-2 pb-2">
				<div className="flex flex-col gap-0.5">
					{steps.map((step, index) => {
						const isActive = currentStep === index;
						const isCompleted = stepCompleted[index];
						const isAccessible = visitedSteps.has(index);

						return (
							<button
								key={step.name}
								type="button"
								onClick={() => isAccessible && onStepClick(index)}
								disabled={!isAccessible}
								aria-current={isActive ? "step" : undefined}
								className={cn(
									"flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-colors w-full",
									isActive
										? "bg-accent"
										: isAccessible
											? "hover:bg-accent/50"
											: "opacity-50 cursor-not-allowed",
								)}
							>
								<div
									className={cn(
										"flex items-center justify-center h-7 w-7 rounded-lg text-xs font-semibold shrink-0 transition-colors",
										isCompleted
											? "bg-valid-green-light-2 text-valid-green"
											: isActive
												? "bg-primary text-primary-foreground"
												: "bg-muted text-muted-foreground",
									)}
								>
									{isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
								</div>
								<div className="flex flex-col min-w-0">
									<span
										className={cn(
											"text-sm leading-tight truncate",
											isActive ? "font-medium text-foreground" : "text-muted-foreground",
										)}
									>
										{step.name}
									</span>
									{step.optional && (
										<span className="text-[10px] text-muted-foreground/70">{t("optional")}</span>
									)}
								</div>
							</button>
						);
					})}
				</div>
			</div>

			{sdkConfigured && (
				<div className="px-3 pb-3">
					<Button variant="outline" size="sm" className="w-full text-xs" onClick={onOverview}>
						{t("sidebar.exit")}
					</Button>
				</div>
			)}
		</div>
	);
}

export function StepNavigation({
	currentStep,
	totalSteps,
	isOptional,
	hasChanges,
	isInteractive,
	isSaving,
	onBack,
	onContinue,
	onSaveAndContinue,
	onSkip,
	onFinish,
}: {
	currentStep: number;
	totalSteps: number;
	isOptional?: boolean;
	hasChanges: boolean;
	isInteractive: boolean;
	isSaving?: boolean;
	onBack: () => void;
	onContinue: () => void;
	onSaveAndContinue: () => void;
	onSkip?: () => void;
	onFinish: () => void;
}) {
	const { t } = useSdkI18n();
	const isLastStep = currentStep === totalSteps - 1;

	const backRef = useNativeClick(onBack);
	const continueRef = useNativeClick(onContinue);
	const saveAndContinueRef = useNativeClick(onSaveAndContinue);
	const finishHandler = isInteractive && hasChanges ? onSaveAndContinue : onFinish;
	const finishRef = useNativeClick(finishHandler);
	const skipRef = useNativeClick(onSkip);

	return (
		<div className="border-t border-sidebar-border bg-card px-6 py-3 flex items-center justify-between">
			<div>
				{currentStep > 0 && (
					<Button variant="outline" size="sm" className="ps-2 pe-4" ref={backRef}>
						<ChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
						{t("nav.back")}
					</Button>
				)}
			</div>
			<span className="text-xs text-muted-foreground">
				{t("nav.step", { current: currentStep + 1, total: totalSteps })}
			</span>
			<div className="flex items-center gap-2">
				{isOptional && onSkip && (
					<Button variant="ghost" size="sm" ref={skipRef}>
						{t("nav.skip")}
					</Button>
				)}
				{isLastStep ? (
					<Button size="sm" className="ps-3 pe-4" disabled={isSaving} ref={finishRef}>
						{isInteractive && hasChanges ? (
							<>
								<Save className="h-3.5 w-3.5" />
								{t(isSaving ? "nav.saving" : "nav.saveFinish")}
							</>
						) : (
							<>
								<Check className="h-3.5 w-3.5" />
								{t("nav.finish")}
							</>
						)}
					</Button>
				) : isInteractive && hasChanges ? (
					<Button size="sm" className="ps-3 pe-4" disabled={isSaving} ref={saveAndContinueRef}>
						<Save className="h-3.5 w-3.5" />
						{t(isSaving ? "nav.saving" : "nav.saveContinue")}
					</Button>
				) : (
					<Button size="sm" className="ps-3 pe-4" ref={continueRef}>
						{t("nav.continue")}
						<ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
					</Button>
				)}
			</div>
		</div>
	);
}
