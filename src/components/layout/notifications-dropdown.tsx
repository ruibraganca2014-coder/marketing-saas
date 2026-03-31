"use client";

import { Bell, Check, Users, Megaphone, Share2, Mail } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";

type Notification = {
  id: string;
  entity_type: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  read?: boolean;
};

const icons: Record<string, typeof Bell> = {
  contact: Users,
  campaign: Megaphone,
  social_post: Share2,
  email_campaign: Mail,
};

export function NotificationsDropdown({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("mkt_activity_log")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10);

    const notifs = (data || []).map((d) => ({ ...d, read: false })) as Notification[];
    setNotifications(notifs);
    setUnread(notifs.length);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }

  function timeAgo(dateStr: string): string {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[10px] flex items-center justify-center text-white bg-red-500 font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-80 rounded-xl border shadow-xl z-50 overflow-hidden"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-sm font-semibold">Notificacoes</span>
            <button onClick={markAllRead} className="text-xs flex items-center gap-1" style={{ color: "var(--primary)" }}>
              <Check size={12} /> Marcar lidas
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>Sem notificacoes</p>
            ) : (
              notifications.map((n) => {
                const Icon = icons[n.entity_type] || Bell;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 ${!n.read ? "bg-blue-500/5" : ""}`}
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="p-1 rounded mt-0.5" style={{ background: "var(--secondary)" }}>
                      <Icon size={12} style={{ color: "var(--primary)" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">
                        <span className="font-medium">{n.entity_type}</span> {n.action}
                      </p>
                    </div>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
