"use client";

import { ChevronLeft, ChevronRight, Globe, Hash, AtSign } from "lucide-react";
import { useState, useMemo } from "react";
import type { SocialPost } from "@/types/database";

const platformConfig: Record<string, { icon: typeof Globe; color: string }> = {
  instagram: { icon: Hash, color: "#E4405F" },
  linkedin: { icon: Globe, color: "#0A66C2" },
  twitter: { icon: AtSign, color: "#1DA1F2" },
  facebook: { icon: Globe, color: "#1877F2" },
};

const DAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type CalendarViewProps = {
  posts: SocialPost[];
  onPostClick?: (post: SocialPost) => void;
};

export function CalendarView({ posts, onPostClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0

    const days: { date: Date; inMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, inMonth: false });
    }

    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), inMonth: true });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), inMonth: false });
    }

    return days;
  }, [year, month]);

  const postsByDate = useMemo(() => {
    const map: Record<string, SocialPost[]> = {};
    posts.forEach((p) => {
      const dateStr = p.scheduled_at
        ? new Date(p.scheduled_at).toISOString().split("T")[0]
        : p.created_at
        ? new Date(p.created_at).toISOString().split("T")[0]
        : null;
      if (dateStr) {
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(p);
      }
    });
    return map;
  }, [posts]);

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100/10 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold">
          {MONTHS_PT[month]} {year}
        </h3>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100/10 transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Days header */}
      <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--border)" }}>
        {DAYS_PT.map((d) => (
          <div key={d} className="text-center text-xs font-medium py-2" style={{ color: "var(--muted-foreground)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, i) => {
          const dateStr = day.date.toISOString().split("T")[0];
          const dayPosts = postsByDate[dateStr] || [];
          const isToday = dateStr === today;

          return (
            <div
              key={i}
              className={`min-h-[80px] p-1 border-b border-r text-xs ${
                !day.inMonth ? "opacity-30" : ""
              }`}
              style={{ borderColor: "var(--border)" }}
            >
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs mb-1 ${
                isToday ? "bg-blue-600 text-white font-bold" : ""
              }`}>
                {day.date.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map((post) => (
                  <button
                    key={post.id}
                    onClick={() => onPostClick?.(post)}
                    className={`w-full text-left px-1 py-0.5 rounded text-[10px] truncate ${
                      post.status === "published"
                        ? "bg-green-500/20 text-green-400"
                        : post.status === "scheduled"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-gray-500/20 text-gray-400"
                    }`}
                  >
                    <span className="flex items-center gap-0.5">
                      {post.platforms.slice(0, 2).map((p) => {
                        const pc = platformConfig[p];
                        if (!pc) return null;
                        const Icon = pc.icon;
                        return <Icon key={p} size={8} />;
                      })}
                      {post.content.slice(0, 20)}
                    </span>
                  </button>
                ))}
                {dayPosts.length > 3 && (
                  <p className="text-[10px] px-1" style={{ color: "var(--muted-foreground)" }}>
                    +{dayPosts.length - 3} mais
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
