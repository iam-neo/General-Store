import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Customers preview" };

export default function CustomersPage() {
  return <PlaceholderPage section="customers" />;
}
