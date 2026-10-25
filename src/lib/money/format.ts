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
