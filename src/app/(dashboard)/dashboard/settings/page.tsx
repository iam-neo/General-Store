import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Settings preview" };

export default function SettingsPage() {
  return <PlaceholderPage section="settings" />;
}
