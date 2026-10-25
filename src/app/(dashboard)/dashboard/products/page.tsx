import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Products preview" };

export default function ProductsPage() {
  return <PlaceholderPage section="products" />;
}
