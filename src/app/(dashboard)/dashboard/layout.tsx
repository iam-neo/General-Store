import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireOwnerSession } from "@/lib/server/auth";

export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Enforce server-side session verification in addition to edge middleware
  await requireOwnerSession();

  return <AppShell>{children}</AppShell>;
}
