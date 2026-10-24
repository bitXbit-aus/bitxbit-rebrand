import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsersTable } from "@/components/admin/users-table";

interface PageProps {
  // Next 15: `searchParams` is a Promise, so the page awaits it.
  //
  // Each value can also be an ARRAY: a repeated query key (`?search=a&search=b`) arrives as
  // `string[]`, not `string`. Typing these as plain `string` was a lie that the compiler
  // cannot catch, and `.trim()` on an array throws — a server-render failure reachable from
  // a crafted URL. Normalise through `firstParam` before use.
  searchParams: Promise<{
    search?: string | string[];
    role?: string | string[];
    status?: string | string[];
    page?: string | string[];
  }>;
}

/** Repeated query keys arrive as arrays; use the first value and ignore the rest. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const supabase = createServiceClient();
  const resolvedSearchParams = await searchParams;

  const search = (firstParam(resolvedSearchParams.search) ?? "").trim();
  const roleFilter = firstParam(resolvedSearchParams.role) ?? "all";
  const statusFilter = firstParam(resolvedSearchParams.status) ?? "all";
  const page = Math.max(1, parseInt(firstParam(resolvedSearchParams.page) ?? "1", 10) || 1);
  const pageSize = 20;

  let query = supabase.from("users").select("*", { count: "exact" });

  if (roleFilter !== "all") {
    query = query.eq("role", roleFilter);
  }

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  if (search) {
    // PostgREST's `or()` takes a RAW filter expression, so a search term containing its
    // separators can inject extra filter clauses. Impact here is limited — the page is
    // admin-only and already lists every user — but an unescaped user value inside a filter
    // string is a footgun regardless, and this file is already being touched.
    // Only `,` `(` `)` `"` are stripped: `.` is left alone so ordinary email searches still work.
    const pattern = `%${search.replace(/[,()"]/g, " ")}%`;
    query = query.or(
      `email.ilike.${pattern},display_name.ilike.${pattern},wallet_address.ilike.${pattern},referral_code.ilike.${pattern}`
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: users, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("Failed to load users:", error);
  }

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Users</h1>
        <p className="text-muted-foreground mt-1">
          Manage members and admins. Total: {count ?? 0}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            Search, filter, edit roles, status, display name and wallet address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersTable
            users={(users ?? []) as any}
            total={count ?? 0}
            page={page}
            pageSize={pageSize}
            search={search}
            roleFilter={roleFilter}
            statusFilter={statusFilter}
          />
        </CardContent>
      </Card>
    </div>
  );
}
