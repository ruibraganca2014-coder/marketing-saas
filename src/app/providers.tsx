"use client";

import { ToastProvider } from "@/components/ui/toast";
import { CommandPalette } from "@/components/ui/command-palette";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  useKeyboardShortcuts();
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShortcutsProvider>
        {children}
        <CommandPalette />
      </ShortcutsProvider>
    </ToastProvider>
  );
}
