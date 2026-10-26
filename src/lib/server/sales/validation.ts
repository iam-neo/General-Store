import type {
  SaleCreateInput,
  SaleCreateItemInput,
} from "@/lib/server/apps-script/types";

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T; errors: null }
  | { success: false; data: null; errors: ValidationError[] };

export function validateSaleCreate(input: unknown): ValidationResult<SaleCreateInput> {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return {
      success: false,
      data: null,
      errors: [{ field: "root", message: "Request body must be a valid JSON object." }],
    };
  }

  const payload = input as Record<string, unknown>;

  // 1. Idempotency Key (Mandatory)
  const idempotencyKey =
    typeof payload.idempotency_key === "string" ? payload.idempotency_key.trim() : "";
  if (!idempotencyKey) {
    errors.push({ field: "idempotency_key", message: "Idempotency key is required." });
  }

  // 2. Items Array
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    errors.push({ field: "items", message: "Sale must contain at least one line item." });
  }

  const validatedItems: SaleCreateItemInput[] = [];

  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        errors.push({ field: `items[${index}]`, message: "Line item must be an object." });
        return;
      }

      const itemObj = item as Record<string, unknown>;
      const productId = typeof itemObj.product_id === "string" ? itemObj.product_id.trim() : "";
      if (!productId) {
        errors.push({ field: `items[${index}].product_id`, message: "Product ID is required." });
      }

      const rawQty = itemObj.quantity;
      const qty = typeof rawQty === "number" ? rawQty : parseFloat(String(rawQty));
      if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
        errors.push({
          field: `items[${index}].quantity`,
          message: "Quantity must be a positive number.",
        });
      }

      let unitPriceSnapshot: number | null | undefined = undefined;
      if (itemObj.unit_price_snapshot !== undefined && itemObj.unit_price_snapshot !== null) {
        const rawPrice = itemObj.unit_price_snapshot;
        const price = typeof rawPrice === "number" ? rawPrice : parseInt(String(rawPrice), 10);
        if (isNaN(price) || !Number.isInteger(price) || price < 0) {
          errors.push({
            field: `items[${index}].unit_price_snapshot`,
            message: "Unit price snapshot must be a non-negative integer in Paisa.",
          });
        } else {
          unitPriceSnapshot = price;
        }
      }

      validatedItems.push({
        product_id: productId,
        quantity: qty,
        unit_price_snapshot: unitPriceSnapshot,
      });
    });
  }

  // 3. Discount Amount (in integer Paisa)
  let discountAmount = 0;
  if (payload.discount_amount !== undefined && payload.discount_amount !== null) {
    const rawDisc = payload.discount_amount;
    const disc = typeof rawDisc === "number" ? rawDisc : parseInt(String(rawDisc), 10);
    if (isNaN(disc) || !Number.isInteger(disc) || disc < 0) {
      errors.push({
        field: "discount_amount",
        message: "Discount amount must be a non-negative integer in Paisa.",
      });
    } else {
      discountAmount = disc;
    }
  }

  // 4. Customer ID (optional)
  const customerId =
    typeof payload.customer_id === "string" && payload.customer_id.trim().length > 0
      ? payload.customer_id.trim()
      : null;

  // 5. Payment Method (Cash only for Phase 7)
  const paymentMethod = "cash" as const;
  if (payload.payment_method !== undefined && payload.payment_method !== null && payload.payment_method !== "") {
    if (payload.payment_method !== "cash") {
      errors.push({
        field: "payment_method",
        message: "Only cash sales are supported in Phase 7.",
      });
    }
  }

  // 6. Actor
  const actor =
    typeof payload.actor === "string" && payload.actor.trim().length > 0
      ? payload.actor.trim()
      : null;

  if (errors.length > 0) {
    return {
      success: false,
      data: null,
      errors,
    };
  }

  return {
    success: true,
    data: {
      idempotency_key: idempotencyKey,
      items: validatedItems,
      discount_amount: discountAmount,
      customer_id: customerId,
      payment_method: paymentMethod,
      actor,
    },
    errors: null,
  };
}
