import type { Metadata } from "next";
import { PosRegister } from "@/components/sales/pos-register";

export const metadata: Metadata = {
  title: "Point of Sale (POS) Register",
  description: "Retail sales register, barcode product lookup, cart calculation, and receipt generation.",
};

export default function SalesPage() {
  return <PosRegister />;
}
