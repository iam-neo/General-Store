export type DashboardSummary = Readonly<{
  salesTodayPaisa: number;
  cashReceivedPaisa: number;
  digitalPaymentsPaisa: number;
  creditSalesTodayPaisa: number;
  outstandingDuesPaisa: number;
}>;

export type PaymentMethod = "cash" | "esewa" | "credit";
export type TransactionStatus = "paid" | "creditDue" | "pending";

export type DemoTransaction = Readonly<{
  id: string;
  customerName: string;
  occurredAtLabel: string;
  method: PaymentMethod;
  amountPaisa: number;
  status: TransactionStatus;
}>;
