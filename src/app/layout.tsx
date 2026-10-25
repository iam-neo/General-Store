import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "General Store Management",
    template: "%s | General Store Management",
  },
  description: "A responsive store-management interface preview for a general store in Nepal.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
