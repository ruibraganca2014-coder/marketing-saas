"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const data = [
  { name: "Social Media", value: 35, color: "#3B82F6" },
  { name: "Email", value: 28, color: "#22C55E" },
  { name: "Ads", value: 22, color: "#F59E0B" },
  { name: "Conteudo", value: 15, color: "#8B5CF6" },
];

export function CampaignROIChart() {
  return (
    <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <h3 className="text-lg font-semibold mb-1">Investimento por Canal</h3>
      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Distribuicao do orcamento de marketing</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [`${value}%`, ""]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
            <span>{item.name}</span>
            <span className="ml-auto font-medium" style={{ color: "var(--foreground)" }}>{item.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
