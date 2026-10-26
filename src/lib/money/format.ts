const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatNpr(amountPaisa: number): string {
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa < 0) {
    return "NPR —";
  }

  return `NPR ${rupeeFormatter.format(amountPaisa / 100)}`;
}

export function paisaToRupees(amountPaisa: number | null | undefined): number {
  if (amountPaisa === null || amountPaisa === undefined || isNaN(amountPaisa)) return 0;
  return amountPaisa / 100;
}

export function rupeesToPaisa(rupees: number | string): number {
  const val = typeof rupees === "string" ? parseFloat(rupees) : rupees;
  if (isNaN(val) || !isFinite(val) || val < 0) return 0;
  return Math.round(val * 100);
}

export function formatPaisa(
  amountPaisa: number | null | undefined,
  locale: "en" | "ne" = "en"
): string {
  if (amountPaisa === null || amountPaisa === undefined || !Number.isFinite(amountPaisa)) {
    return "—";
  }
  const prefix = locale === "ne" ? "रु " : "रु ";
  return `${prefix}${rupeeFormatter.format(amountPaisa / 100)}`;
}
