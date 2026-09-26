"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Copy, Users, MousePointer, TrendingUp } from "lucide-react";

interface Referral {
  id: string;
  display_name: string | null;
  email: string;
  created_at: string;
  wallet_address: string | null;
}

export default function ReferralsPage() {
  const supabase = createClient();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [clicks, setClicks] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: currentUser } = await supabase
        .from("users")
        .select("referral_code")
        .eq("id", user.id)
        .single();

      setReferralCode(currentUser?.referral_code ?? null);

      const { data: referralsData } = await supabase
        .from("users")
        .select("id, display_name, email, created_at, wallet_address")
        .eq("referred_by", user.id)
        .order("created_at", { ascending: false });

      const refs = referralsData ?? [];
      setReferrals(refs);

      if (refs.length > 0) {
        const ids = refs.map((r) => r.id);
        const [{ data: activities }, { data: rewards }] = await Promise.all([
          supabase.from("user_activities").select("activity_type").in("user_id", ids),
          supabase.from("user_rewards").select("estimated_aud_value").in("user_id", ids),
        ]);

        setClicks(activities?.filter((a) => a.activity_type === "click").length ?? 0);
        const totalRewards = rewards?.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0) ?? 0;
        setBonus(totalRewards * 0.05);
      }

      setLoading(false);
    };

    fetchData();
  }, [supabase]);

  const referralLink = referralCode
    ? `https://app.bitxbit.com.au/auth/signup?ref=${referralCode}`
    : null;

  const handleCopy = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
    }
  };

  if (loading) {
    return <div className="dashboard-container text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="dashboard-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Referrals</h1>
        <p className="text-muted-foreground mt-1">
          Invite others and earn a 5% bonus on their reward-generating activity.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Referred Members</div>
                <div className="text-2xl font-bold">{referrals.length}</div>
              </div>
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Referral Clicks</div>
                <div className="text-2xl font-bold">{clicks}</div>
              </div>
              <MousePointer className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Est. 5% Bonus</div>
                <div className="text-2xl font-bold">{formatCurrency(bonus)}</div>
              </div>
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Your Referral Link</CardTitle>
          <CardDescription>Share this link to invite new members.</CardDescription>
        </CardHeader>
        <CardContent>
          {referralLink ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                readOnly
                value={referralLink}
                className="input flex-1"
              />
              <Button type="button" className="shrink-0" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Your referral code is being generated.</p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            You earn 5% of the reward-generating activity from anyone who joins through your link.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referred Members</CardTitle>
          <CardDescription>People who joined using your link.</CardDescription>
        </CardHeader>
        <CardContent>
          {referrals.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr key={referral.id}>
                    <td>
                      <div className="font-medium">{referral.display_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{referral.email}</div>
                    </td>
                    <td>{formatDate(referral.created_at)}</td>
                    <td>
                      <Badge variant={referral.wallet_address ? "default" : "outline"}>
                        {referral.wallet_address ? "Wallet connected" : "No wallet"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No referrals yet. Share your link to start building your network.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
