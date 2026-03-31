import { type LucideIcon } from "lucide-react";

type KpiCardProps = {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
};

export function KpiCard({ title, value, change, changeType = "neutral", icon: Icon }: KpiCardProps) {
  const changeColor =
    changeType === "positive"
      ? "text-green-600"
      : changeType === "negative"
      ? "text-red-600"
      : "text-gray-500";

  return (
    <div
      className="rounded-xl border p-6 transition-shadow hover:shadow-md"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
            {title}
          </p>
          <p className="text-2xl font-bold mt-1" style={{ color: "var(--card-foreground)" }}>
            {value}
          </p>
          {change && (
            <p className={`text-xs mt-1 ${changeColor}`}>{change}</p>
          )}
        </div>
        <div
          className="p-3 rounded-lg"
          style={{ background: "var(--secondary)" }}
        >
          <Icon size={24} style={{ color: "var(--primary)" }} />
        </div>
      </div>
    </div>
  );
}
