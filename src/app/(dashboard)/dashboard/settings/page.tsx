import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

import { BackendDiagnostic } from "@/components/dashboard/backend-diagnostic";

export const metadata: Metadata = { title: "Settings preview" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PlaceholderPage section="settings" />
      <BackendDiagnostic />
    </div>
  );
}
