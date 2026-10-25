import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Credit preview" };

export default function CreditPage() {
  return <PlaceholderPage section="credit" />;
}
