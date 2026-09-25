import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, truncateAddress } from "@/lib/utils";

export default async function AdminUsersPage() {
  const supabase = createClient();
  const { data: users } = await supabase.from("users").select("*").order("created_at", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Users</h1>
        <p className="text-muted-foreground mt-1">Manage community members.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
        </CardHeader>
        <CardContent>
          {users && users.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Display Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Wallet</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.display_name ?? "—"}</td>
                    <td>{u.email}</td>
                    <td>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                    </td>
                    <td className="font-mono text-xs">{truncateAddress(u.wallet_address)}</td>
                    <td>
                      <Badge variant={u.status === "active" ? "default" : "destructive"}>{u.status}</Badge>
                    </td>
                    <td>{formatDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
