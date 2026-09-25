import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateProfile } from "@/lib/actions";
import { formatDate } from "@/lib/utils";

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("*").eq("id", user?.id).single();

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Profile</h1>
        <p className="text-muted-foreground mt-1">Manage your account and wallet settings.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your basic account details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Email</Label>
              <p className="text-sm text-foreground">{profile?.email}</p>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <div>
                <Badge variant={profile?.role === "admin" ? "default" : "secondary"}>{profile?.role}</Badge>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Member Since</Label>
              <p className="text-sm text-foreground">{formatDate(profile?.created_at)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Update Profile</CardTitle>
            <CardDescription>Change your display name and wallet address.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateProfile} className="space-y-4">
              <input type="hidden" name="userId" value={profile?.id} />
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input id="displayName" name="displayName" defaultValue={profile?.display_name ?? ""} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="walletAddress">Wallet Address</Label>
                <Input id="walletAddress" name="walletAddress" defaultValue={profile?.wallet_address ?? ""} placeholder="Solana wallet address" />
                <p className="text-xs text-muted-foreground">Used for BxB token reward distribution.</p>
              </div>
              <Button type="submit">Save Changes</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
