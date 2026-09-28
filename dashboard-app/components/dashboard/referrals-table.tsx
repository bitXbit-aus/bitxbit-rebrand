"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/utils";
import { Search, UserPlus, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface ReferralWithStats {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  wallet_address: string | null;
  activities: number;
  rewards: number;
  bonus: number;
}

type SortKey = "created_at" | "activities" | "rewards" | "bonus";
type SortDir = "asc" | "desc";

interface ReferralsTableProps {
  referrals: ReferralWithStats[];
}

const PAGE_SIZE = 10;

export function ReferralsTable({ referrals }: ReferralsTableProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "created_at",
    dir: "desc",
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return referrals.filter((r) => {
      if (!term) return true;
      const name = r.display_name?.toLowerCase() ?? "";
      const email = r.email?.toLowerCase() ?? "";
      return name.includes(term) || email.includes(term);
    });
  }, [referrals, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "created_at") {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
      return (a[sort.key] - b[sort.key]) * dir;
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      dir: current.key === key && current.dir === "desc" ? "asc" : "desc",
    }));
    setPage(1);
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sort.key !== column) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1" />
    );
  };

  if (referrals.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No referrals yet</h3>
          <p className="text-sm text-muted-foreground">
            Share your link to start building your network.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Referred Members</CardTitle>
        <CardDescription>
          People who joined using your link and the value they&apos;ve generated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          {search && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th
                  className="cursor-pointer"
                  onClick={() => toggleSort("created_at")}
                >
                  <span className="inline-flex items-center">Joined <SortIcon column="created_at" /></span>
                </th>
                <th
                  className="cursor-pointer"
                  onClick={() => toggleSort("activities")}
                >
                  <span className="inline-flex items-center">Activities <SortIcon column="activities" /></span>
                </th>
                <th
                  className="cursor-pointer"
                  onClick={() => toggleSort("rewards")}
                >
                  <span className="inline-flex items-center">Rewards Generated <SortIcon column="rewards" /></span>
                </th>
                <th
                  className="cursor-pointer"
                  onClick={() => toggleSort("bonus")}
                >
                  <span className="inline-flex items-center">Your Bonus <SortIcon column="bonus" /></span>
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((referral) => (
                <tr key={referral.id}>
                  <td>
                    <div className="font-medium">{referral.display_name ?? "Anonymous"}</div>
                    <div className="text-xs text-muted-foreground">{referral.email}</div>
                  </td>
                  <td>
                    <div>{formatDate(referral.created_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(referral.created_at)}
                    </div>
                  </td>
                  <td>{referral.activities}</td>
                  <td>{formatCurrency(referral.rewards)}</td>
                  <td>{formatCurrency(referral.bonus)}</td>
                  <td>
                    <Badge variant={referral.wallet_address ? "default" : "outline"}>
                      {referral.wallet_address ? "Wallet connected" : "No wallet"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {paginated.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No referrals match your search.</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} · {sorted.length} members
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
      </CardContent>
    </Card>
  );
}
