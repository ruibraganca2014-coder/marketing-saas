import { type LucideIcon } from "lucide-react";
import { Button } from "./button";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="text-center py-16 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--secondary)" }}>
        <Icon size={28} style={{ color: "var(--primary)" }} />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm max-w-xs mx-auto mb-6" style={{ color: "var(--muted-foreground)" }}>
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}
