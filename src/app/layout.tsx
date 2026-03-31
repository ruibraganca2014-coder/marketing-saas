import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Marketing SaaS - Gestao de Marketing",
  description: "Plataforma completa de gestao de marketing: CRM, Campanhas, Social Media e Email Marketing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
