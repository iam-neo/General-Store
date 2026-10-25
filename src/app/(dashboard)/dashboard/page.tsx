import type { Metadata } from "next";
import { DashboardPreview } from "@/components/dashboard-preview";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return <DashboardPreview />;
}
