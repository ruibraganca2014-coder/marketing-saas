"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";

type RealtimeCallback = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void;

/**
 * Subscribe to realtime changes on a Supabase table
 */
export function useRealtime(
  table: string,
  orgId: string | undefined,
  callback: RealtimeCallback
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!orgId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          callbackRef.current({
            eventType: payload.eventType,
            new: (payload.new || {}) as Record<string, unknown>,
            old: (payload.old || {}) as Record<string, unknown>,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, orgId]);
}
