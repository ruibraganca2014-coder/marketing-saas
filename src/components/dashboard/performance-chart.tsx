"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { name: "Seg", leads: 12, conversoes: 3, visits: 240 },
  { name: "Ter", leads: 19, conversoes: 5, visits: 310 },
  { name: "Qua", leads: 15, conversoes: 4, visits: 280 },
  { name: "Qui", leads: 22, conversoes: 7, visits: 390 },
  { name: "Sex", leads: 28, conversoes: 9, visits: 420 },
  { name: "Sab", leads: 8, conversoes: 2, visits: 180 },
  { name: "Dom", leads: 5, conversoes: 1, visits: 120 },
];

export function PerformanceChart() {
  return (
    <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <h3 className="text-lg font-semibold mb-1">Performance Semanal</h3>
      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Leads, conversoes e visitas dos ultimos 7 dias</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorConversoes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
            <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Area type="monotone" dataKey="leads" stroke="#3B82F6" fillOpacity={1} fill="url(#colorLeads)" strokeWidth={2} />
            <Area type="monotone" dataKey="conversoes" stroke="#22C55E" fillOpacity={1} fill="url(#colorConversoes)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 mt-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-blue-500" /> Leads</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-green-500" /> Conversoes</div>
      </div>
    </div>
  );
}
