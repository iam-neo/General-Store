import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "New sale preview" };

export default function SalesPage() {
  return <PlaceholderPage section="newSale" />;
}
