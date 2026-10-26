import {
  PRODUCT_UNITS,
  type ProductCreateInput,
  type ProductUnit,
  type ProductUpdateInput,
  type StockAdjustmentInput,
} from "@/lib/server/apps-script/types";

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T; errors: null }
  | { success: false; data: null; errors: ValidationError[] };

const DISCRETE_UNITS: ReadonlySet<string> = new Set(["piece", "packet", "bottle"]);

export function isDiscreteUnit(unit: string): boolean {
  return DISCRETE_UNITS.has(unit.toLowerCase().trim());
}

export function isValidQuantityForUnit(quantity: number, unit: string): boolean {
  if (typeof quantity !== "number" || isNaN(quantity) || !isFinite(quantity)) {
    return false;
  }
  if (quantity < 0) {
    return false;
  }
  if (isDiscreteUnit(unit)) {
    return Number.isInteger(quantity);
  }
  // Continuous units (kg, gram, litre, metre) allow up to 3 decimal places
  const rounded = Math.round(quantity * 1000) / 1000;
  return Math.abs(quantity - rounded) < 0.0001;
}

export function validateProductCreate(input: unknown): ValidationResult<ProductCreateInput> {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return {
      success: false,
      data: null,
      errors: [{ field: "root", message: "Request body must be a valid JSON object." }],
    };
  }

  const payload = input as Record<string, unknown>;

  // 1. Name
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    errors.push({ field: "name", message: "Product name is required." });
  } else if (name.length > 150) {
    errors.push({ field: "name", message: "Product name cannot exceed 150 characters." });
  }

  // 2. Unit
  const rawUnit = typeof payload.unit === "string" ? payload.unit.trim().toLowerCase() : "";
  const unit = PRODUCT_UNITS.find((u) => u === rawUnit) as ProductUnit | undefined;
  if (!unit) {
    errors.push({
      field: "unit",
      message: `Unit must be one of: ${PRODUCT_UNITS.join(", ")}.`,
    });
  }

  // 3. Category
  const category = typeof payload.category === "string" && payload.category.trim()
    ? payload.category.trim()
    : "General";
  if (category.length > 60) {
    errors.push({ field: "category", message: "Category cannot exceed 60 characters." });
  }

  // 4. Selling Price (Integer Paisa)
  const sellingPrice = payload.selling_price;
  if (typeof sellingPrice !== "number" || !Number.isInteger(sellingPrice) || sellingPrice <= 0) {
    errors.push({
      field: "selling_price",
      message: "Selling price must be a positive integer in Paisa (e.g. 15000 Paisa = NPR 150.00).",
    });
  }

  // 5. Cost Price (Optional Integer Paisa)
  let costPrice: number | null = null;
  if (payload.cost_price !== undefined && payload.cost_price !== null && payload.cost_price !== "") {
    if (typeof payload.cost_price !== "number" || !Number.isInteger(payload.cost_price) || payload.cost_price < 0) {
      errors.push({
        field: "cost_price",
        message: "Cost price must be a non-negative integer in Paisa if provided.",
      });
    } else {
      costPrice = payload.cost_price;
    }
  }

  // 6. Opening Quantity
  let openingQuantity = 0;
  if (payload.opening_quantity !== undefined && payload.opening_quantity !== null && payload.opening_quantity !== "") {
    if (typeof payload.opening_quantity !== "number" || payload.opening_quantity < 0) {
      errors.push({
        field: "opening_quantity",
        message: "Opening quantity must be a non-negative number.",
      });
    } else if (unit && !isValidQuantityForUnit(payload.opening_quantity, unit)) {
      errors.push({
        field: "opening_quantity",
        message: isDiscreteUnit(unit)
          ? `Opening quantity must be an integer for unit '${unit}'.`
          : `Opening quantity can have at most 3 decimal places for unit '${unit}'.`,
      });
    } else {
      openingQuantity = payload.opening_quantity;
    }
  }

  // 7. Low Stock Threshold
  let lowStockThreshold = 5;
  if (payload.low_stock_threshold !== undefined && payload.low_stock_threshold !== null && payload.low_stock_threshold !== "") {
    if (typeof payload.low_stock_threshold !== "number" || payload.low_stock_threshold < 0) {
      errors.push({
        field: "low_stock_threshold",
        message: "Low stock threshold must be a non-negative number.",
      });
    } else {
      lowStockThreshold = payload.low_stock_threshold;
    }
  }

  // 8. SKU / Barcode (Optional)
  let sku: string | null = null;
  if (typeof payload.sku === "string" && payload.sku.trim()) {
    const trimmedSku = payload.sku.trim();
    if (trimmedSku.length > 50) {
      errors.push({ field: "sku", message: "SKU / Barcode cannot exceed 50 characters." });
    } else if (!/^[a-zA-Z0-9_\-\./]+$/.test(trimmedSku)) {
      errors.push({
        field: "sku",
        message: "SKU / Barcode may only contain letters, numbers, dashes, underscores, dots, and slashes.",
      });
    } else {
      sku = trimmedSku;
    }
  }

  // 9. Active Flag
  const isActive = payload.is_active === undefined ? true : Boolean(payload.is_active);

  // 10. Idempotency Key
  const idempotencyKey = typeof payload.idempotency_key === "string" && payload.idempotency_key.trim()
    ? payload.idempotency_key.trim()
    : undefined;

  if (errors.length > 0) {
    return { success: false, data: null, errors };
  }

  return {
    success: true,
    data: {
      name,
      category,
      unit: unit!,
      selling_price: sellingPrice as number,
      cost_price: costPrice,
      opening_quantity: openingQuantity,
      low_stock_threshold: lowStockThreshold,
      is_active: isActive,
      sku,
      idempotency_key: idempotencyKey,
    },
    errors: null,
  };
}

export function validateProductUpdate(input: unknown): ValidationResult<ProductUpdateInput> {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return {
      success: false,
      data: null,
      errors: [{ field: "root", message: "Request body must be a valid JSON object." }],
    };
  }

  const payload = input as Record<string, unknown>;
  const result: {
    name?: string;
    sku?: string | null;
    category?: string;
    unit?: string;
    selling_price?: number;
    cost_price?: number | null;
    low_stock_threshold?: number;
    is_active?: boolean;
  } = {};

  // 1. Name
  if (payload.name !== undefined) {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      errors.push({ field: "name", message: "Product name cannot be empty." });
    } else if (payload.name.trim().length > 150) {
      errors.push({ field: "name", message: "Product name cannot exceed 150 characters." });
    } else {
      result.name = payload.name.trim();
    }
  }

  // 2. Unit
  if (payload.unit !== undefined) {
    const rawUnit = typeof payload.unit === "string" ? payload.unit.trim().toLowerCase() : "";
    const unit = PRODUCT_UNITS.find((u) => u === rawUnit);
    if (!unit) {
      errors.push({
        field: "unit",
        message: `Unit must be one of: ${PRODUCT_UNITS.join(", ")}.`,
      });
    } else {
      result.unit = unit;
    }
  }

  // 3. Category
  if (payload.category !== undefined) {
    if (typeof payload.category !== "string" || !payload.category.trim()) {
      errors.push({ field: "category", message: "Category cannot be empty." });
    } else if (payload.category.trim().length > 60) {
      errors.push({ field: "category", message: "Category cannot exceed 60 characters." });
    } else {
      result.category = payload.category.trim();
    }
  }

  // 4. Selling Price
  if (payload.selling_price !== undefined) {
    if (
      typeof payload.selling_price !== "number" ||
      !Number.isInteger(payload.selling_price) ||
      payload.selling_price <= 0
    ) {
      errors.push({
        field: "selling_price",
        message: "Selling price must be a positive integer in Paisa.",
      });
    } else {
      result.selling_price = payload.selling_price;
    }
  }

  // 5. Cost Price
  if (payload.cost_price !== undefined) {
    if (payload.cost_price === null || payload.cost_price === "") {
      result.cost_price = null;
    } else if (
      typeof payload.cost_price !== "number" ||
      !Number.isInteger(payload.cost_price) ||
      payload.cost_price < 0
    ) {
      errors.push({
        field: "cost_price",
        message: "Cost price must be a non-negative integer in Paisa if provided.",
      });
    } else {
      result.cost_price = payload.cost_price;
    }
  }

  // 6. Low Stock Threshold
  if (payload.low_stock_threshold !== undefined) {
    if (
      typeof payload.low_stock_threshold !== "number" ||
      payload.low_stock_threshold < 0
    ) {
      errors.push({
        field: "low_stock_threshold",
        message: "Low stock threshold must be a non-negative number.",
      });
    } else {
      result.low_stock_threshold = payload.low_stock_threshold;
    }
  }

  // 7. SKU / Barcode
  if (payload.sku !== undefined) {
    if (payload.sku === null || payload.sku === "") {
      result.sku = null;
    } else if (typeof payload.sku === "string") {
      const trimmedSku = payload.sku.trim();
      if (trimmedSku.length > 50) {
        errors.push({ field: "sku", message: "SKU / Barcode cannot exceed 50 characters." });
      } else if (!/^[a-zA-Z0-9_\-\./]+$/.test(trimmedSku)) {
        errors.push({
          field: "sku",
          message: "SKU / Barcode may only contain letters, numbers, dashes, underscores, dots, and slashes.",
        });
      } else {
        result.sku = trimmedSku;
      }
    } else {
      errors.push({ field: "sku", message: "SKU must be a string or null." });
    }
  }

  // 8. Active Flag
  if (payload.is_active !== undefined) {
    result.is_active = Boolean(payload.is_active);
  }

  if (errors.length > 0) {
    return { success: false, data: null, errors };
  }

  return { success: true, data: result, errors: null };
}

export function validateStockAdjustment(input: unknown): ValidationResult<StockAdjustmentInput> {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return {
      success: false,
      data: null,
      errors: [{ field: "root", message: "Request body must be a valid JSON object." }],
    };
  }

  const payload = input as Record<string, unknown>;

  // 1. Adjustment Type
  const allowedTypes = ["set", "increase", "decrease", "restock", "damage", "correction"] as const;
  const rawType = typeof payload.adjustment_type === "string" ? payload.adjustment_type.trim().toLowerCase() : "";
  const adjustmentType = allowedTypes.find((t) => t === rawType);
  if (!adjustmentType) {
    errors.push({
      field: "adjustment_type",
      message: `Adjustment type must be one of: ${allowedTypes.join(", ")}.`,
    });
  }

  // 2. Quantity
  const quantity = payload.quantity;
  if (typeof quantity !== "number" || isNaN(quantity) || !isFinite(quantity) || quantity < 0) {
    errors.push({
      field: "quantity",
      message: "Quantity must be a non-negative number.",
    });
  }

  // 3. Reason
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!reason) {
    errors.push({ field: "reason", message: "Reason for stock adjustment is required." });
  } else if (reason.length < 3) {
    errors.push({ field: "reason", message: "Reason must be at least 3 characters long." });
  } else if (reason.length > 250) {
    errors.push({ field: "reason", message: "Reason cannot exceed 250 characters." });
  }

  // 4. Notes
  const notes = typeof payload.notes === "string" && payload.notes.trim()
    ? payload.notes.trim()
    : null;

  // 5. Idempotency Key (Required for stock adjustments to prevent duplicate mutations)
  const idempotencyKey = typeof payload.idempotency_key === "string" && payload.idempotency_key.trim()
    ? payload.idempotency_key.trim()
    : undefined;
  if (!idempotencyKey) {
    errors.push({
      field: "idempotency_key",
      message: "Idempotency key is required for stock adjustments to prevent duplicate mutations.",
    });
  }

  // 6. Actor (Optional operator username or identifier)
  const actor = typeof payload.actor === "string" && payload.actor.trim()
    ? payload.actor.trim()
    : undefined;

  if (errors.length > 0) {
    return { success: false, data: null, errors };
  }

  return {
    success: true,
    data: {
      adjustment_type: adjustmentType!,
      quantity: quantity as number,
      reason,
      notes,
      actor,
      idempotency_key: idempotencyKey!,
    },
    errors: null,
  };
}
