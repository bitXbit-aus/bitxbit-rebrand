import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsersTable } from "@/components/admin/users-table";

interface PageProps {
  searchParams: {
    search?: string;
    role?: string;
    status?: string;
    page?: string;
  };
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const supabase = createServiceClient();

  const search = (searchParams.search ?? "").trim();
  const roleFilter = searchParams.role ?? "all";
  const statusFilter = searchParams.status ?? "all";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const pageSize = 20;

  let query = supabase.from("users").select("*", { count: "exact" });

  if (roleFilter !== "all") {
    query = query.eq("role", roleFilter);
  }

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  if (search) {
    const pattern = `%${search}%`;
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
