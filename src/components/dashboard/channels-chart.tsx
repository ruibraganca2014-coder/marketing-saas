"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const data = [
  { name: "LinkedIn", leads: 42, color: "#0A66C2" },
  { name: "Website", leads: 35, color: "#3B82F6" },
  { name: "Ads", leads: 28, color: "#F59E0B" },
  { name: "Email", leads: 22, color: "#22C55E" },
  { name: "Referral", leads: 18, color: "#8B5CF6" },
  { name: "Instagram", leads: 15, color: "#E4405F" },
];

export function ChannelsChart() {
  return (
    <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <h3 className="text-lg font-semibold mb-1">Leads por Canal</h3>
      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Distribuicao de leads por origem</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} width={70} />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="leads" radius={[0, 4, 4, 0]} barSize={20}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
