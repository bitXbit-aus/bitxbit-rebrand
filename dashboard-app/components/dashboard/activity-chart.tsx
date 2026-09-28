"use client";

import { useMemo } from "react";
import { formatDate } from "@/lib/utils";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ActivityChartItem {
  id: string;
  created_at: string;
  activity_type: string;
}

interface ActivityChartProps {
  activities: ActivityChartItem[];
}

export function ActivityChart({ activities }: ActivityChartProps) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    activities.forEach((a) => {
      const key = formatDate(a.created_at);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => new Date(a.name).getTime() - new Date(b.name).getTime())
      .slice(-14);
  }, [activities]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.2 }}
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
