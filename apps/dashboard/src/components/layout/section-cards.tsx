"use client";

import { GripVertical, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

export interface DashBoardCardType {
  title: string;
  value: string | number;
  valueType?: string;
  secondaryValue: string;
  secondaryValueType?: string;
  tooltip?: string;
}

interface SectionCardsProps {
  cards: DashBoardCardType[];
  cardKeys?: string[];
  onReorder?: (keys: string[]) => void;
}

const numberFormatter = new Intl.NumberFormat("de-DE");

function formatMainValue(card: DashBoardCardType) {
  if (card.valueType === "money") {
    return `${formatCurrencyFromCents(Number(card.value))}`;
  }
  if (card.valueType === "percent") {
    return `${numberFormatter.format(Number(card.value))}%`;
  }
  return numberFormatter.format(Number(card.value));
}

function CardContent({ card }: { card: DashBoardCardType }) {
  const change = Number(card.secondaryValue);
  const isPositive = change > 0;
  const isNegative = change < 0;
  const hasChange = change !== 0;

  return (
    <>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-sm text-muted-foreground">{card.title}</span>
        {card.tooltip && (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
            </TooltipTrigger>
            <TooltipContent>
              <p>{card.tooltip}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {formatMainValue(card)}
        </span>

        {hasChange && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
              isPositive &&
                "bg-valid-green-light-2 text-valid-green dark:bg-valid-green/15 dark:text-emerald-400",
              isNegative &&
                "bg-destructive-secondary text-destructive dark:bg-destructive/15 dark:text-red-400"
            )}
          >
            {isNegative ? (
              <TrendingDown className="h-3.5 w-3.5" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" />
            )}
            {numberFormatter.format(Math.abs(change))}%
          </span>
        )}
      </div>

      {hasChange && (
        <p className="mt-2 text-xs text-muted-foreground/70">
          vs. previous period
        </p>
      )}
    </>
  );
}

function SortableCard({ id, card }: { id: string; card: DashBoardCardType }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-md border border-sidebar-border bg-[#FAFAFA] p-5 transition-colors hover:border-border dark:bg-card",
        isDragging && "opacity-50"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <CardContent card={card} />
    </div>
  );
}

function StaticCard({ card }: { card: DashBoardCardType }) {
  return (
    <div className="relative rounded-md border border-sidebar-border bg-[#FAFAFA] p-5 transition-colors hover:border-border dark:bg-card">
      <CardContent card={card} />
    </div>
  );
}

function SortableCardGrid({
  cards,
  cardKeys,
  onReorder,
}: {
  cards: DashBoardCardType[];
  cardKeys: string[];
  onReorder: (keys: string[]) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  const activeIndex = activeId ? cardKeys.indexOf(activeId) : -1;
  const activeCard = activeIndex >= 0 ? cards[activeIndex] : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = cardKeys.indexOf(active.id as string);
    const newIndex = cardKeys.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newKeys = arrayMove(cardKeys, oldIndex, newIndex);
    onReorder(newKeys);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={cardKeys} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          {cardKeys.map((key, index) => {
            const card = cards[index];
            if (!card) return null;
            return <SortableCard key={key} id={key} card={card} />;
          })}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeCard ? (
          <div className="rounded-md border border-sidebar-border bg-[#FAFAFA] p-5 shadow-lg scale-[1.02] dark:bg-card">
            <CardContent card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function SectionCards({
  cards,
  cardKeys,
  onReorder,
}: SectionCardsProps) {
  if (!cardKeys || !onReorder) {
    return (
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {cards.map((card) => (
          <StaticCard key={card.title} card={card} />
        ))}
      </div>
    );
  }

  return (
    <SortableCardGrid cards={cards} cardKeys={cardKeys} onReorder={onReorder} />
  );
}
