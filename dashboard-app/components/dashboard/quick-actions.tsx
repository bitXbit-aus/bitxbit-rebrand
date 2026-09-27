import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

const actions = [
  { label: "Explore referral offers", href: "/dashboard/offers" },
  { label: "Connect your Solana wallet", href: "/dashboard/wallet" },
  { label: "View transparency reports", href: "/dashboard/transparency" },
  { label: "Share your referral link", href: "/dashboard/referrals" },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next Steps</CardTitle>
        <CardDescription>Get the most out of bitXbit.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
            >
              <span className="text-sm font-medium">{action.label}</span>
              <span className="text-primary text-sm">→</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
