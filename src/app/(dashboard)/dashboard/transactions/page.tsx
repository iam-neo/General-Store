import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Transactions preview" };

export default function TransactionsPage() {
  return <PlaceholderPage section="transactions" />;
}
