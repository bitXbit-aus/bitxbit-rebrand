"use client"

import { Button } from "@/components/ui/button"
import { ActivityType } from "@/types"

const activityTypes: { value: ActivityType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "click", label: "Clicks" },
  { value: "signup", label: "Signups" },
  { value: "purchase", label: "Purchases" },
]

const periods = [
  { value: "all", label: "All time" },
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
]

interface ActivityFiltersProps {
  type: ActivityType | "all"
  period: string
  onTypeChange: (type: ActivityType | "all") => void
  onPeriodChange: (period: string) => void
}

export function ActivityFilters({ type, period, onTypeChange, onPeriodChange }: ActivityFiltersProps) {
  return (
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
  )
}
