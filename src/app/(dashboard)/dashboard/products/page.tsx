import type { Metadata } from "next";
import { ProductsView } from "@/components/products/products-view";

export const metadata: Metadata = {
  title: "Products & Inventory",
  description: "Product catalog, barcode scanner, stock management, and pricing controls.",
};

export default function ProductsPage() {
  return <ProductsView />;
}
