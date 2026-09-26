import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateUser } from "@/lib/actions";
import { formatDate, truncateAddress } from "@/lib/utils";

export default async function AdminUsersPage() {
  const supabase = createClient();
  const { data: users, count } = await supabase
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Users</h1>
        <p className="text-muted-foreground mt-1">Manage members and admins. Total: {count ?? 0}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>Edit roles, status, display name and wallet address.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users?.map((user) => (
              <div key={user.id} className="p-4 rounded-lg border border-border bg-card/50">
                <form action={updateUser.bind(null, user.id)}>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                      <div className="text-sm font-medium truncate">{user.email}</div>
                      <div className="text-xs text-muted-foreground">{user.referral_code}</div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Display Name</label>
                      <input name="displayName" defaultValue={user.display_name ?? ""} className="input w-full" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Wallet</label>
                      <input name="walletAddress" defaultValue={user.wallet_address ?? ""} className="input w-full" placeholder="Solana address" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Referred By</label>
                      <div className="text-sm text-muted-foreground truncate">
                        {user.referred_by ? user.referred_by.slice(0, 8) + "..." : "—"}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                      <select name="role" defaultValue={user.role} className="input w-full">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                      <select name="status" defaultValue={user.status} className="input w-full">
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </div>
                    <div className="md:col-span-12 flex justify-end">
                      <Button type="submit" size="sm">Save</Button>
                    </div>
                  </div>
                </form>
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <Badge variant={user.role === "admin" ? "default" : "outline"}>{user.role}</Badge>
                  <Badge variant={user.status === "active" ? "default" : "secondary"}>{user.status}</Badge>
                  <span>Joined {formatDate(user.created_at)}</span>
                  {user.last_login && <span>· Last login {formatDate(user.last_login)}</span>}
                  {user.wallet_address && <span className="font-mono">· {truncateAddress(user.wallet_address)}</span>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
