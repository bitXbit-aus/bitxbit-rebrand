"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { useToast } from "@/components/ui/use-toast";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { ActivityType } from "@/types";
import {
  Activity,
  Circle,
  Download,
  MousePointerClick,
  Search,
  SearchX,
  ShoppingCart,
  UserPlus,
  X,
} from "lucide-react";

interface AdminActivityItem {
  id: string;
  activity_type: ActivityType;
  source_url: string | null;
  created_at: string;
  user: { id: string; email: string | null; display_name: string | null } | null;
  offer: { name: string | null; referral_url: string | null } | null;
}

interface AdminActivityTableProps {
  activities: AdminActivityItem[];
}

const activityConfig: Record<
  ActivityType,
  {
    label: string;
    icon: React.ElementType;
    colorClass: string;
    bgClass: string;
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
};

function ActivityIcon({ type }: { type: ActivityType }) {
  const config = activityConfig[type] ?? activityConfig.other;
  const Icon = config.icon;
  return (
    <div className={`h-8 w-8 rounded-full border flex items-center justify-center ${config.bgClass}`}>
      <Icon className={`h-4 w-4 ${config.colorClass}`} />
    </div>
  );
}

function exportToCSV(activities: AdminActivityItem[]) {
  const rows = [
    ["Date", "Type", "User", "Email", "Offer", "Source URL"],
    ...activities.map((a) => [
      new Date(a.created_at).toISOString(),
      a.activity_type,
      a.user?.display_name ?? "—",
      a.user?.email ?? "—",
      a.offer?.name ?? "Direct",
      a.source_url ?? "",
    ]),
  ];

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bitxbit-admin-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 25;
const periods = [
  { value: "all", label: "All time" },
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
];
const activityTypes: { value: ActivityType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "click", label: "Clicks" },
  { value: "signup", label: "Signups" },
  { value: "purchase", label: "Purchases" },
];

export function AdminActivityTable({ activities }: AdminActivityTableProps) {
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const now = Date.now();
    const term = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (typeFilter !== "all" && a.activity_type !== typeFilter) return false;
      if (periodFilter !== "all") {
        const days = parseInt(periodFilter, 10);
        const then = new Date(a.created_at).getTime();
        if (now - then > days * 24 * 60 * 60 * 1000) return false;
      }
      if (term) {
        const userName = a.user?.display_name?.toLowerCase() ?? "";
        const email = a.user?.email?.toLowerCase() ?? "";
        const offerName = a.offer?.name?.toLowerCase() ?? "";
        const source = a.source_url?.toLowerCase() ?? "";
        const type = a.activity_type.toLowerCase();
        if (
          !userName.includes(term) &&
          !email.includes(term) &&
          !offerName.includes(term) &&
          !source.includes(term) &&
          !type.includes(term)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activities, typeFilter, periodFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const stats = useMemo(() => {
    const clicks = filtered.filter((a) => a.activity_type === "click").length;
    const signups = filtered.filter((a) => a.activity_type === "signup").length;
    const purchases = filtered.filter((a) => a.activity_type === "purchase").length;
    return [
      { label: "Total", value: filtered.length, icon: Activity },
      { label: "Clicks", value: clicks, icon: MousePointerClick },
      { label: "Signups", value: signups, icon: UserPlus },
      { label: "Purchases", value: purchases, icon: ShoppingCart },
    ];
  }, [filtered]);

  const handleExport = () => {
    try {
      exportToCSV(filtered);
      toast({
        title: "Exported",
        description: `${filtered.length} activity record${filtered.length === 1 ? "" : "s"} downloaded.`,
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate CSV.",
        variant: "destructive",
      });
    }
  };

  const hasFilters = typeFilter !== "all" || periodFilter !== "all" || search.trim() !== "";

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
            <CardDescription>Platform activity volume over the last 14 active days.</CardDescription>
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
            <CardTitle>All Activity</CardTitle>
            <CardDescription>Every tracked event across all members.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search user, email, offer, source URL, or type..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTypeFilter("all");
                    setPeriodFilter("all");
                    setSearch("");
                    setPage(1);
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
                    variant={typeFilter === t.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setTypeFilter(t.value);
                      setPage(1);
                    }}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {periods.map((p) => (
                  <Button
                    key={p.value}
                    variant={periodFilter === p.value ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => {
                      setPeriodFilter(p.value);
                      setPage(1);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <SearchX className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-medium">No matching activity</h3>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-10"></th>
                      <th>Type</th>
                      <th>User</th>
                      <th>Offer</th>
                      <th>Source</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((activity) => {
                      const config = activityConfig[activity.activity_type] ?? activityConfig.other;
                      return (
                        <tr key={activity.id}>
                          <td>
                            <ActivityIcon type={activity.activity_type} />
                          </td>
                          <td>
                            <Badge variant="outline" className={config.colorClass}>
                              {config.label}
                            </Badge>
                          </td>
                          <td>
                            {activity.user ? (
                              <div>
                                <div className="font-medium">
                                  {activity.user.display_name ?? "Anonymous"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {activity.user.email}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td>
                            {activity.offer?.name ? (
                              <a
                                href={activity.offer.referral_url ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary hover:underline"
                              >
                                {activity.offer.name}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">Direct</span>
                            )}
                          </td>
                          <td className="max-w-xs truncate">
                            {activity.source_url ? (
                              <a
                                href={activity.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-xs"
                              >
                                {activity.source_url.length > 40
                                  ? `${activity.source_url.slice(0, 40)}…`
                                  : activity.source_url}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td>
                            <div className="text-sm">{formatDate(activity.created_at)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatRelativeTime(activity.created_at)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages} · {filtered.length} records
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
  );
}
