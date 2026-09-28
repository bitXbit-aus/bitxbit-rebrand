"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Activity,
  Circle,
  Download,
  MousePointerClick,
  SearchX,
  ShoppingCart,
  UserPlus,
} from "lucide-react"
import { formatDate, formatRelativeTime } from "@/lib/utils"
import { ActivityType } from "@/types"
import { ActivityFilters } from "./activity-filters"
import { ActivityChart } from "./activity-chart"
import { useToast } from "@/components/ui/use-toast"

interface ActivityItem {
  id: string
  activity_type: ActivityType
  source_url: string | null
  created_at: string
  offer: { name: string | null; referral_url: string | null }[] | null
}

interface ActivityTimelineProps {
  activities: ActivityItem[]
}

const activityConfig: Record<
  ActivityType,
  {
    label: string
    icon: React.ElementType
    colorClass: string
    bgClass: string
  }
> = {
  click: {
    label: "Clicked referral link",
    icon: MousePointerClick,
    colorClass: "text-blue-500",
    bgClass: "bg-blue-500/10 border-blue-500/20",
  },
  signup: {
    label: "Signed up via referral",
    icon: UserPlus,
    colorClass: "text-emerald-500",
    bgClass: "bg-emerald-500/10 border-emerald-500/20",
  },
  purchase: {
    label: "Completed purchase",
    icon: ShoppingCart,
    colorClass: "text-amber-500",
    bgClass: "bg-amber-500/10 border-amber-500/20",
  },
  other: {
    label: "Activity recorded",
    icon: Circle,
    colorClass: "text-muted-foreground",
    bgClass: "bg-muted border-border",
  },
}

function ActivityIcon({ type }: { type: ActivityType }) {
  const config = activityConfig[type] ?? activityConfig.other
  const Icon = config.icon
  return (
    <div
      className={`h-8 w-8 rounded-full border flex items-center justify-center ${config.bgClass}`}
    >
      <Icon className={`h-4 w-4 ${config.colorClass}`} />
    </div>
  )
}

function groupByDate(activities: ActivityItem[]) {
  const groups = new Map<string, ActivityItem[]>()
  activities.forEach((a) => {
    const date = formatDate(a.created_at)
    const existing = groups.get(date) ?? []
    existing.push(a)
    groups.set(date, existing)
  })
  return Array.from(groups.entries()).sort(
    (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
  )
}

function exportToCSV(activities: ActivityItem[]) {
  const rows = [
    ["Date", "Type", "Offer", "Source URL"],
    ...activities.map((a) => [
      new Date(a.created_at).toISOString(),
      a.activity_type,
      a.offer?.[0]?.name ?? "Direct",
      a.source_url ?? "",
    ]),
  ]

  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `bitxbit-activity-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const PAGE_SIZE = 20

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all")
  const [periodFilter, setPeriodFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const { toast } = useToast()

  const filtered = useMemo(() => {
    const now = Date.now()
    const term = search.trim().toLowerCase()
    return activities.filter((a) => {
      if (typeFilter !== "all" && a.activity_type !== typeFilter) return false
      if (periodFilter !== "all") {
        const days = parseInt(periodFilter, 10)
        const then = new Date(a.created_at).getTime()
        if (now - then > days * 24 * 60 * 60 * 1000) return false
      }
      if (term) {
        const offerName = a.offer?.[0]?.name?.toLowerCase() ?? ""
        const source = a.source_url?.toLowerCase() ?? ""
        const type = a.activity_type.toLowerCase()
        if (!offerName.includes(term) && !source.includes(term) && !type.includes(term)) {
          return false
        }
      }
      return true
    })
  }, [activities, typeFilter, periodFilter, search])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])
  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginatedGroups = grouped.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const stats = useMemo(() => {
    const clicks = filtered.filter((a) => a.activity_type === "click").length
    const signups = filtered.filter((a) => a.activity_type === "signup").length
    const purchases = filtered.filter((a) => a.activity_type === "purchase").length
    return [
      { label: "Total", value: filtered.length, icon: Activity },
      { label: "Clicks", value: clicks, icon: MousePointerClick },
      { label: "Signups", value: signups, icon: UserPlus },
      { label: "Purchases", value: purchases, icon: ShoppingCart },
    ]
  }, [filtered])

  const handleExport = () => {
    try {
      exportToCSV(filtered)
      toast({
        title: "Exported",
        description: `${filtered.length} activity record${filtered.length === 1 ? "" : "s"} downloaded.`,
      })
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate CSV.",
        variant: "destructive",
      })
    }
  }

  if (activities.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-16">
          <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No activity yet</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Start exploring offers to generate referral activity.
          </p>
          <Button asChild>
            <Link href="/dashboard/offers">Explore Offers</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">{stat.label}</div>
                <stat.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity Trend</CardTitle>
            <CardDescription>Activity volume over the last 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ActivityChart activities={filtered} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <CardTitle>Activity Timeline</CardTitle>
            <CardDescription>
              Track every referral link click, signup, and purchase.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <ActivityFilters
            type={typeFilter}
            period={periodFilter}
            search={search}
            onTypeChange={(type) => {
              setTypeFilter(type)
              setPage(1)
            }}
            onPeriodChange={(period) => {
              setPeriodFilter(period)
              setPage(1)
            }}
            onSearchChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
          />

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <SearchX className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-medium">No matching activity</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Try adjusting your filters.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {paginatedGroups.map(([date, items]) => (
                <div key={date}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 sticky top-0 bg-card/95 backdrop-blur py-1 z-10">
                    {date}
                  </h3>
                  <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                    <div className="space-y-6">
                      {items.map((activity) => {
                        const config = activityConfig[activity.activity_type] ?? activityConfig.other
                        return (
                          <div key={activity.id} className="relative flex gap-4">
                            <div className="relative z-10 shrink-0">
                              <ActivityIcon type={activity.activity_type} />
                            </div>
                            <div className="flex-1 min-w-0 pt-1">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                                <p className="text-sm font-medium">{config.label}</p>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatRelativeTime(activity.created_at)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {activity.offer?.[0]?.name ? (
                                  <a
                                    href={activity.offer[0].referral_url ?? "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-primary hover:underline"
                                  >
                                    {activity.offer[0].name}
                                  </a>
                                ) : (
                                  "Direct"
                                )}
                              </p>
                              {activity.source_url && (
                                <p className="text-xs text-muted-foreground mt-1 truncate">
                                  Source:{" "}
                                  <a
                                    href={activity.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    {activity.source_url}
                                  </a>
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="text-sm text-muted-foreground">
                    Showing {currentPage} of {totalPages} date groups
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
