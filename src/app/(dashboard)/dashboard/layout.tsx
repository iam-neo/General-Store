import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

// This route group shares dashboard UI only; it does not authenticate or protect the route.
export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
