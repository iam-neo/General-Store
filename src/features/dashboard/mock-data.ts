import type { DashboardSummary, DemoTransaction } from "@/features/dashboard/types";

export const demoSummary: DashboardSummary = {
  salesTodayPaisa: 4_325_000,
  cashReceivedPaisa: 2_780_000,
  digitalPaymentsPaisa: 695_000,
  creditSalesTodayPaisa: 850_000,
  outstandingDuesPaisa: 7_625_000,
};

export const demoTransactions: readonly DemoTransaction[] = [
  {
    id: "DEMO-2083-0042",
    customerName: "Mina Karki",
    occurredAtLabel: "Oct 25 · 10:42",
    method: "cash",
    amountPaisa: 125_000,
    status: "paid",
  },
  {
    id: "DEMO-2083-0041",
    customerName: "राममाया अधिकारी",
    occurredAtLabel: "Oct 25 · 10:18",
    method: "credit",
    amountPaisa: 382_500,
    status: "creditDue",
  },
  {
    id: "DEMO-2083-0040",
    customerName: "Suman Bahadur Gurung",
    occurredAtLabel: "Oct 25 · 09:56",
    method: "esewa",
    amountPaisa: 249_000,
    status: "paid",
  },
  {
    id: "DEMO-2083-0039",
    customerName: "सीता कुमारी थापा",
    occurredAtLabel: "Oct 25 · 09:31",
    method: "cash",
    amountPaisa: 87_500,
    status: "paid",
  },
  {
    id: "DEMO-2083-0038",
    customerName: "Krishna Maya Shrestha",
    occurredAtLabel: "Oct 25 · 09:06",
    method: "esewa",
    amountPaisa: 156_000,
    status: "pending",
  },
];
