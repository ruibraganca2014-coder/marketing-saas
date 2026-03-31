"use client";

import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="md:ml-64 p-4 md:p-6 pt-14 md:pt-6 transition-all duration-300">
        {children}
      </main>
    </div>
  );
}
