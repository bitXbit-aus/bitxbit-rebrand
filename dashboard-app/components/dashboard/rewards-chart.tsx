"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface RewardPeriod {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  user_rewards: { estimated_aud_value: number | null; status: string }[];
}

interface RewardsChartProps {
  periods: RewardPeriod[];
}

export function RewardsChart({ periods }: RewardsChartProps) {
  const data = periods.map((period) => {
    const earned = period.user_rewards.reduce((sum, r) => sum + (r.estimated_aud_value ?? 0), 0);
    const label = new Date(period.end_date).toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
    return {
      name: label,
      earned,
      status: period.status,
    };
  }).reverse();

  const totalEarned = data.reduce((sum, d) => sum + d.earned, 0);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reward History</CardTitle>
          <CardDescription>Your estimated rewards across completed periods.</CardDescription>
        </CardHeader>
        <CardContent className="h-[240px] flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No reward periods yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Reward History</CardTitle>
            <CardDescription>Your estimated rewards across completed periods.</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total estimated</p>
            <p className="text-2xl font-bold">{formatCurrency(totalEarned)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.2 }}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="earned" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
