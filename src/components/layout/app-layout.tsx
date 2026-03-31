"use client";

import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="ml-64 p-6 transition-all duration-300">
        {children}
      </main>
    </div>
  );
}
