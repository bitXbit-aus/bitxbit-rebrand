"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormWithToast } from "@/components/dashboard/form-with-toast";
import { useToast } from "@/components/ui/use-toast";
import {
  updateUser,
  bulkUpdateUsersRole,
  bulkUpdateUsersStatus,
  bulkDeleteUsers,
} from "@/lib/actions";
import { formatDate, truncateAddress } from "@/lib/utils";

interface User {
  id: string;
  email: string | null;
  display_name: string | null;
  wallet_address: string | null;
  referral_code: string | null;
  referred_by: string | null;
  role: string;
  status: string;
  created_at: string;
  last_login: string | null;
}

interface UsersTableProps {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  roleFilter: string;
  statusFilter: string;
}

function buildQueryString(
  base: { toString(): string },
  updates: Record<string, string | number | null>
): string {
  const params = new URLSearchParams(base.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === "" || value === "all") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

export function UsersTable({
  users,
  total,
  page,
  pageSize,
  search,
  roleFilter,
  statusFilter,
}: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      users.forEach((u) => next.delete(u.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      users.forEach((u) => next.add(u.id));
      setSelected(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const navigate = (updates: Record<string, string | number | null>) => {
    const query = buildQueryString(searchParams, updates);
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  };

  const handleBulkAction = async (action: "role" | "status" | "delete") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    try {
      if (action === "delete") {
        if (!confirm(`Delete ${ids.length} user(s)? This cannot be undone.`)) return;
        await bulkDeleteUsers(ids);
        toast({ title: "Deleted", description: `${ids.length} user(s) removed.` });
      } else if (action === "role") {
        const role = prompt("Set role to:", "member");
        if (!role || !["member", "admin"].includes(role)) return;
        await bulkUpdateUsersRole(ids, role);
        toast({ title: "Role updated", description: `${ids.length} user(s) set to ${role}.` });
      } else if (action === "status") {
        const status = prompt("Set status to:", "active");
        if (!status || !["active", "suspended"].includes(status)) return;
        await bulkUpdateUsersStatus(ids, status);
        toast({ title: "Status updated", description: `${ids.length} user(s) set to ${status}.` });
      }

      setSelected(new Set());
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <form
          className="flex flex-1 flex-col md:flex-row gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            navigate({
              search: formData.get("search") as string,
              page: 1,
            });
          }}
        >
          <input
            name="search"
            type="search"
            placeholder="Search email, name, wallet, referral code..."
            defaultValue={search}
            className="input flex-1"
          />
          <select
            name="role"
            value={roleFilter}
            onChange={(e) => navigate({ role: e.target.value, page: 1 })}
            className="input w-full md:w-40"
          >
            <option value="all">All roles</option>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <select
            name="status"
            value={statusFilter}
            onChange={(e) => navigate({ status: e.target.value, page: 1 })}
            className="input w-full md:w-40"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => handleBulkAction("role")}>
            Set role
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleBulkAction("status")}>
            Set status
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleBulkAction("delete")}>
            Delete
          </Button>
        </div>
      )}

      {/* Table header */}
      <div className="hidden md:grid md:grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
        <div className="col-span-1">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-border"
          />
        </div>
        <div className="col-span-3">User</div>
        <div className="col-span-2">Wallet</div>
        <div className="col-span-2">Referral</div>
        <div className="col-span-2">Role / Status</div>
        <div className="col-span-2">Joined</div>
      </div>

      {/* User rows */}
      <div className="space-y-3">
        {users.map((user) => (
          <div
            key={user.id}
            className="p-4 rounded-lg border border-border bg-card/50"
          >
            <FormWithToast
              action={updateUser.bind(null, user.id)}
              successMessage="User updated"
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-1 pt-2">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggleSelect(user.id)}
                    className="h-4 w-4 rounded border-border"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 md:hidden">
                    User
                  </label>
                  <div className="text-sm font-medium truncate">{user.email ?? "No email"}</div>
                  <input
                    name="displayName"
                    defaultValue={user.display_name ?? ""}
                    placeholder="Display name"
                    className="input w-full mt-1 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 md:hidden">
                    Wallet
                  </label>
                  <input
                    name="walletAddress"
                    defaultValue={user.wallet_address ?? ""}
                    className="input w-full text-sm"
                    placeholder="Solana address"
                  />
                  {user.wallet_address && (
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      {truncateAddress(user.wallet_address)}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 md:hidden">
                    Referral
                  </label>
                  <div className="text-sm text-muted-foreground truncate">
                    {user.referral_code ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {user.referred_by ? `Referred: ${user.referred_by.slice(0, 8)}...` : "—"}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 md:hidden">
                    Role / Status
                  </label>
                  <select name="role" defaultValue={user.role} className="input w-full text-sm">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <select name="status" defaultValue={user.status} className="input w-full text-sm mt-2">
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 md:hidden">
                    Joined
                  </label>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(user.created_at)}
                  </div>
                  {user.last_login && (
                    <div className="text-xs text-muted-foreground">
                      Last login {formatDate(user.last_login)}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2 md:mt-3">
                    <Badge
                      variant={user.role === "admin" ? "default" : "outline"}
                      className="text-xs"
                    >
                      {user.role}
                    </Badge>
                    <Badge
                      variant={user.status === "active" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {user.status}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  Save
                </Button>
              </div>
            </FormWithToast>
          </div>
        ))}
      </div>

      {users.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No users match your filters.
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="text-sm text-muted-foreground">
          Showing {start}-{end} of {total}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => navigate({ page: page - 1 })}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => navigate({ page: page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
