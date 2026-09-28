"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActivityType } from "@/types";
import { Search, X } from "lucide-react";

const activityTypes: { value: ActivityType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "click", label: "Clicks" },
  { value: "signup", label: "Signups" },
  { value: "purchase", label: "Purchases" },
];

const periods = [
  { value: "all", label: "All time" },
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
];

interface ActivityFiltersProps {
  type: ActivityType | "all";
  period: string;
  search: string;
  onTypeChange: (type: ActivityType | "all") => void;
  onPeriodChange: (period: string) => void;
  onSearchChange: (search: string) => void;
}

export function ActivityFilters({
  type,
  period,
  search,
  onTypeChange,
  onPeriodChange,
  onSearchChange,
}: ActivityFiltersProps) {
  const hasFilters = type !== "all" || period !== "all" || search.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search offer or source URL..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onTypeChange("all");
              onPeriodChange("all");
              onSearchChange("");
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {activityTypes.map((t) => (
            <Button
              key={t.value}
              variant={type === t.value ? "default" : "outline"}
              size="sm"
              onClick={() => onTypeChange(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "secondary" : "outline"}
              size="sm"
              onClick={() => onPeriodChange(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
