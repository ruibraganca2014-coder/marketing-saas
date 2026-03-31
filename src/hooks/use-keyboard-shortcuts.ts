"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Global keyboard shortcuts:
 * - Alt+D: Dashboard
 * - Alt+C: Contacts
 * - Alt+P: Pipeline
 * - Alt+M: Campaigns (Marketing)
 * - Alt+S: Social Media
 * - Alt+E: Email
 * - Alt+A: Analytics
 * - Alt+L: Logs
 * - Alt+N: New (opens command palette)
 */
export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "d": e.preventDefault(); router.push("/dashboard"); break;
          case "c": e.preventDefault(); router.push("/contacts"); break;
          case "p": e.preventDefault(); router.push("/contacts/deals"); break;
          case "m": e.preventDefault(); router.push("/campaigns"); break;
          case "s": e.preventDefault(); router.push("/social"); break;
          case "e": e.preventDefault(); router.push("/email"); break;
          case "a": e.preventDefault(); router.push("/analytics"); break;
          case "l": e.preventDefault(); router.push("/logs"); break;
          case "x": e.preventDefault(); router.push("/settings"); break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);
}
