/**
 * API Endpoint Handlers for Google Apps Script Backend.
 */

var Handlers = (function () {
  function handleHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      backend: "google-apps-script",
      environment: "production"
    };
  }

  function handleSchemaStatus() {
    var ss = Database.getSpreadsheet();
    return Schema.inspectSchema(ss);
  }

  function handleInitDatabase() {
    var ss = Database.getSpreadsheet();
    return Schema.initializeDatabase(ss);
  }

  function handleTestRecordCreate(payload) {
    if (!Config.isTestWriteAllowed()) {
      throw {
        code: "TEST_WRITE_DISABLED",
        message: "Test record creation is disabled on this backend deployment (ALLOW_TEST_WRITES is false)."
      };
    }

    if (!payload || typeof payload !== "object") {
      throw {
        code: "VALIDATION_ERROR",
        message: "Missing request payload."
      };
    }

    var message = payload.message ? String(payload.message).trim() : "";
    var nonce = payload.nonce ? String(payload.nonce).trim() : "";

    if (!message) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Field 'message' is required and must be a non-empty string."
      };
    }

    if (!nonce) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Field 'nonce' is required and must be a non-empty string."
      };
    }

    if (message.length > 500) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Field 'message' exceeds maximum permitted length of 500 characters."
      };
    }

    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("SystemTest");
    if (!sheet) {
      Schema.initializeDatabase(ss);
      sheet = ss.getSheetByName("SystemTest");
    }

    return Database.withLock(15000, function () {
      // Check for duplicate nonce
      var existing = Database.findRecordByField(sheet, "nonce", nonce);
      if (existing) {
        throw {
          code: "DUPLICATE_RECORD",
          message: "A test record with nonce '" + nonce + "' already exists. Duplicate test submissions are rejected."
        };
      }

      var testId = "test-" + Database.generateUuid();
      var now = new Date().toISOString();

      var record = {
        test_id: testId,
        message: message,
        nonce: nonce,
        created_at: now
      };

      var headers = Config.SCHEMA.find(function (s) {
        return s.name === "SystemTest";
      }).headers;

      Database.appendRecord(sheet, record, headers);

      return record;
    });
  }

  function handleTestRecordGet(payload) {
    if (!payload || !payload.identifier) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Field 'identifier' is required to retrieve a test record."
      };
    }

    var identifier = String(payload.identifier).trim();
    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("SystemTest");

    if (!sheet) {
      throw {
        code: "RECORD_NOT_FOUND",
        message: "SystemTest sheet does not exist."
      };
    }

    // Try finding by test_id first, then nonce
    var found = Database.findRecordByField(sheet, "test_id", identifier);
    if (!found) {
      found = Database.findRecordByField(sheet, "nonce", identifier);
    }

    if (!found) {
      throw {
        code: "RECORD_NOT_FOUND",
        message: "No test record found matching identifier '" + identifier + "'."
      };
    }

    return found.record;
  }

  function handleTestRecordCleanup(payload) {
    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("SystemTest");

    if (!sheet) {
      return {
        deletedCount: 0,
        message: "SystemTest sheet does not exist. Nothing to clean up."
      };
    }

    return Database.withLock(15000, function () {
      var identifier = payload && payload.identifier ? String(payload.identifier).trim() : null;
      var deleted = 0;

      if (identifier) {
        deleted += Database.deleteRecordsByField(sheet, "test_id", identifier);
        if (deleted === 0) {
          deleted += Database.deleteRecordsByField(sheet, "nonce", identifier);
        }
      } else {
        // Clean up all rows except header
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          deleted = lastRow - 1;
          sheet.deleteRows(2, deleted);
        }
      }

      return {
        deletedCount: deleted,
        message: "Successfully deleted " + deleted + " test record(s)."
      };
    });
  }

  function normalizeProduct(rec) {
    return {
      product_id: String(rec.product_id || ""),
      name: String(rec.name || ""),
      sku: rec.sku ? String(rec.sku) : null,
      category: String(rec.category || "General"),
      unit: String(rec.unit || "piece"),
      selling_price: Number(rec.selling_price) || 0,
      cost_price: rec.cost_price !== "" && rec.cost_price !== null && rec.cost_price !== undefined ? Number(rec.cost_price) : null,
      stock_quantity: Number(rec.stock_quantity) || 0,
      opening_quantity: Number(rec.opening_quantity) || 0,
      low_stock_threshold: Number(rec.low_stock_threshold) || 5,
      is_active: rec.is_active === true || String(rec.is_active).toUpperCase() === "TRUE",
      created_at: String(rec.created_at || ""),
      updated_at: String(rec.updated_at || "")
    };
  }

  function normalizeAdjustment(rec) {
    var qtyChange = rec.quantity_change !== undefined && rec.quantity_change !== ""
      ? Number(rec.quantity_change)
      : (rec.change_quantity !== undefined && rec.change_quantity !== "" ? Number(rec.change_quantity) : 0);

    var prevStock = rec.previous_stock !== undefined && rec.previous_stock !== ""
      ? Number(rec.previous_stock)
      : (rec.previous_quantity !== undefined && rec.previous_quantity !== "" ? Number(rec.previous_quantity) : 0);

    var newStock = rec.new_stock !== undefined && rec.new_stock !== ""
      ? Number(rec.new_stock)
      : (rec.new_quantity !== undefined && rec.new_quantity !== "" ? Number(rec.new_quantity) : 0);

    return {
      adjustment_id: String(rec.adjustment_id || ""),
      product_id: String(rec.product_id || ""),
      adjustment_type: String(rec.adjustment_type || "correction"),
      quantity_change: qtyChange,
      previous_stock: prevStock,
      new_stock: newStock,
      reason: String(rec.reason || ""),
      notes: rec.notes ? String(rec.notes) : null,
      actor: rec.actor ? String(rec.actor) : null,
      idempotency_key: rec.idempotency_key ? String(rec.idempotency_key) : null,
      created_at: String(rec.created_at || "")
    };
  }

  function handleProductsList(payload) {
    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("Products");
    if (!sheet) {
      Schema.initializeDatabase(ss);
      sheet = ss.getSheetByName("Products");
    }

    var allRowRecords = Database.getAllRecords(sheet);
    var allProducts = [];
    for (var i = 0; i < allRowRecords.length; i++) {
      allProducts.push(normalizeProduct(allRowRecords[i].record));
    }

    var filter = payload || {};
    var filtered = allProducts.slice();

    if (filter.status === "active") {
      filtered = filtered.filter(function (p) { return p.is_active; });
    } else if (filter.status === "inactive") {
      filtered = filtered.filter(function (p) { return !p.is_active; });
    }

    if (filter.category) {
      var cat = String(filter.category).toLowerCase().trim();
      filtered = filtered.filter(function (p) { return p.category.toLowerCase() === cat; });
    }

    if (filter.low_stock) {
      filtered = filtered.filter(function (p) {
        return p.is_active && p.stock_quantity <= p.low_stock_threshold;
      });
    }

    if (filter.search) {
      var q = String(filter.search).toLowerCase().trim();
      filtered = filtered.filter(function (p) {
        return (
          p.name.toLowerCase().indexOf(q) !== -1 ||
          (p.sku && p.sku.toLowerCase().indexOf(q) !== -1) ||
          p.category.toLowerCase().indexOf(q) !== -1
        );
      });
    }

    // Sort by updated_at descending
    filtered.sort(function (a, b) {
      var ta = new Date(a.updated_at).getTime() || 0;
      var tb = new Date(b.updated_at).getTime() || 0;
      return tb - ta;
    });

    var page = Math.max(1, Number(filter.page) || 1);
    var limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    var total = filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / limit));
    var startIndex = (page - 1) * limit;
    var pageItems = filtered.slice(startIndex, startIndex + limit);

    var categorySet = {};
    for (var c = 0; c < allProducts.length; c++) {
      categorySet[allProducts[c].category] = true;
    }
    var categories = Object.keys(categorySet).sort();

    var summary = {
      totalCount: allProducts.length,
      activeCount: allProducts.filter(function (p) { return p.is_active; }).length,
      inactiveCount: allProducts.filter(function (p) { return !p.is_active; }).length,
      lowStockCount: allProducts.filter(function (p) {
        return p.is_active && p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold;
      }).length,
      outOfStockCount: allProducts.filter(function (p) {
        return p.is_active && p.stock_quantity <= 0;
      }).length
    };

    return {
      products: pageItems,
      total: total,
      page: page,
      limit: limit,
      totalPages: totalPages,
      categories: categories,
      summary: summary
    };
  }

  function handleProductCreate(payload) {
    if (!payload || typeof payload !== "object") {
      throw { code: "VALIDATION_ERROR", message: "Missing product payload." };
    }

    var name = payload.name ? String(payload.name).trim() : "";
    if (!name) {
      throw { code: "VALIDATION_ERROR", message: "Product name is required." };
    }

    var unit = payload.unit ? String(payload.unit).trim().toLowerCase() : "piece";
    var sellingPrice = Number(payload.selling_price);
    if (isNaN(sellingPrice) || sellingPrice <= 0) {
      throw { code: "VALIDATION_ERROR", message: "Selling price must be a positive integer in Paisa." };
    }

    var sku = payload.sku ? String(payload.sku).trim() : null;

    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("Products");
    if (!sheet) {
      Schema.initializeDatabase(ss);
      sheet = ss.getSheetByName("Products");
    }

    return Database.withLock(15000, function () {
      if (sku) {
        var allRecords = Database.getAllRecords(sheet);
        var skuLower = sku.toLowerCase();
        for (var s = 0; s < allRecords.length; s++) {
          var rSku = allRecords[s].record.sku ? String(allRecords[s].record.sku).trim().toLowerCase() : "";
          if (rSku && rSku === skuLower) {
            throw {
              code: "DUPLICATE_RECORD",
              message: "A product with SKU '" + sku + "' already exists."
            };
          }
        }
      }

      var now = new Date().toISOString();
      var productId = Database.generateUuid();
      var openingQty = Number(payload.opening_quantity) || 0;

      var productRecord = {
        product_id: productId,
        name: name,
        sku: sku || "",
        category: payload.category ? String(payload.category).trim() : "General",
        unit: unit,
        selling_price: Math.round(sellingPrice),
        cost_price: payload.cost_price !== undefined && payload.cost_price !== null && payload.cost_price !== ""
          ? Math.round(Number(payload.cost_price))
          : "",
        stock_quantity: openingQty,
        opening_quantity: openingQty,
        low_stock_threshold: payload.low_stock_threshold !== undefined && payload.low_stock_threshold !== null
          ? Number(payload.low_stock_threshold)
          : 5,
        is_active: payload.is_active === false ? "FALSE" : "TRUE",
        created_at: now,
        updated_at: now
      };

      var headers = Config.SCHEMA.find(function (s) {
        return s.name === "Products";
      }).headers;

      Database.appendRecord(sheet, productRecord, headers);
      return normalizeProduct(productRecord);
    });
  }

  function handleProductGet(payload) {
    if (!payload || !payload.product_id) {
      throw { code: "VALIDATION_ERROR", message: "Field 'product_id' is required." };
    }

    var productId = String(payload.product_id).trim();
    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("Products");
    if (!sheet) {
      throw { code: "RECORD_NOT_FOUND", message: "Products sheet not found." };
    }

    var found = Database.findRecordByField(sheet, "product_id", productId);
    if (!found) {
      throw { code: "RECORD_NOT_FOUND", message: "Product with ID '" + productId + "' not found." };
    }

    var adjSheet = ss.getSheetByName("InventoryAdjustments");
    var adjustments = [];
    if (adjSheet) {
      var allAdj = Database.getAllRecords(adjSheet);
      for (var a = 0; a < allAdj.length; a++) {
        var rec = allAdj[a].record;
        if (String(rec.product_id) === productId) {
          adjustments.push(normalizeAdjustment(rec));
        }
      }
      adjustments.sort(function (x, y) {
        return new Date(y.created_at).getTime() - new Date(x.created_at).getTime();
      });
    }

    return {
      product: normalizeProduct(found.record),
      adjustments: adjustments
    };
  }

  function handleProductUpdate(payload) {
    if (!payload || !payload.product_id) {
      throw { code: "VALIDATION_ERROR", message: "Field 'product_id' is required." };
    }

    var productId = String(payload.product_id).trim();
    var ss = Database.getSpreadsheet();
    var sheet = ss.getSheetByName("Products");
    if (!sheet) {
      throw { code: "RECORD_NOT_FOUND", message: "Products sheet not found." };
    }

    return Database.withLock(15000, function () {
      var found = Database.findRecordByField(sheet, "product_id", productId);
      if (!found) {
        throw { code: "RECORD_NOT_FOUND", message: "Product with ID '" + productId + "' not found." };
      }

      var current = found.record;
      var updates = { updated_at: new Date().toISOString() };

      if (payload.name !== undefined) updates.name = String(payload.name).trim();
      if (payload.category !== undefined) updates.category = String(payload.category).trim();
      if (payload.unit !== undefined) updates.unit = String(payload.unit).trim().toLowerCase();
      if (payload.selling_price !== undefined) updates.selling_price = Math.round(Number(payload.selling_price));
      if (payload.cost_price !== undefined) {
        updates.cost_price = payload.cost_price !== null && payload.cost_price !== ""
          ? Math.round(Number(payload.cost_price))
          : "";
      }
      if (payload.low_stock_threshold !== undefined) {
        updates.low_stock_threshold = Number(payload.low_stock_threshold);
      }
      if (payload.is_active !== undefined) {
        updates.is_active = payload.is_active ? "TRUE" : "FALSE";
      }

      if (payload.sku !== undefined) {
        var newSku = payload.sku ? String(payload.sku).trim() : "";
        if (newSku && newSku.toLowerCase() !== String(current.sku || "").toLowerCase()) {
          var allRecords = Database.getAllRecords(sheet);
          var skuLower = newSku.toLowerCase();
          for (var sk = 0; sk < allRecords.length; sk++) {
            var recSku = allRecords[sk].record.sku ? String(allRecords[sk].record.sku).trim().toLowerCase() : "";
            if (recSku && recSku === skuLower && String(allRecords[sk].record.product_id) !== productId) {
              throw {
                code: "DUPLICATE_RECORD",
                message: "A product with SKU '" + newSku + "' already exists."
              };
            }
          }
        }
        updates.sku = newSku;
      }

      Database.updateRecord(sheet, found.rowIndex, updates);

      for (var k in updates) {
        current[k] = updates[k];
      }
      return normalizeProduct(current);
    });
  }

  function handleProductAdjustStock(payload) {
    if (!payload || !payload.product_id) {
      throw { code: "VALIDATION_ERROR", message: "Field 'product_id' is required." };
    }

    var idempKey = payload.idempotency_key ? String(payload.idempotency_key).trim() : "";
    if (!idempKey) {
      throw { code: "VALIDATION_ERROR", message: "Field 'idempotency_key' is required for stock adjustments." };
    }

    var productId = String(payload.product_id).trim();
    var adjType = String(payload.adjustment_type || "correction").toLowerCase();
    var qty = Number(payload.quantity);
    var reason = String(payload.reason || "").trim();

    if (isNaN(qty) || qty < 0) {
      throw { code: "VALIDATION_ERROR", message: "Quantity must be a valid non-negative number." };
    }
    if (!reason) {
      throw { code: "VALIDATION_ERROR", message: "Reason for stock adjustment is required." };
    }

    var ss = Database.getSpreadsheet();
    var prodSheet = ss.getSheetByName("Products");
    if (!prodSheet) {
      throw { code: "RECORD_NOT_FOUND", message: "Products sheet not found." };
    }

    var adjSheet = ss.getSheetByName("InventoryAdjustments");
    if (!adjSheet) {
      Schema.initializeDatabase(ss);
      adjSheet = ss.getSheetByName("InventoryAdjustments");
    }

    return Database.withLock(15000, function () {
      // 1. Idempotency check: if an idempotency_key was already processed
      var existingAdj = Database.findRecordByField(adjSheet, "idempotency_key", idempKey);
      if (existingAdj) {
        var existingProduct = Database.findRecordByField(prodSheet, "product_id", productId);
        var normAdj = normalizeAdjustment(existingAdj.record);

        // Self-healing / reconciliation if previous attempt crashed before product stock was updated
        if (existingProduct && Number(existingProduct.record.stock_quantity) !== normAdj.new_stock) {
          Database.updateRecord(prodSheet, existingProduct.rowIndex, {
            stock_quantity: normAdj.new_stock,
            updated_at: new Date().toISOString()
          });
          existingProduct = Database.findRecordByField(prodSheet, "product_id", productId);
        }

        return {
          product: existingProduct ? normalizeProduct(existingProduct.record) : null,
          adjustment: normAdj
        };
      }

      // 2. Find product
      var found = Database.findRecordByField(prodSheet, "product_id", productId);
      if (!found) {
        throw { code: "RECORD_NOT_FOUND", message: "Product with ID '" + productId + "' not found." };
      }

      // 3. Unit validation: piece-based units reject fractional quantities; continuous units allow up to 3 decimals
      var unit = String(found.record.unit || "").trim().toLowerCase();
      var isDiscrete = unit === "piece" || unit === "packet" || unit === "bottle";
      if (isDiscrete) {
        if (Math.floor(qty) !== qty) {
          throw { code: "VALIDATION_ERROR", message: "Quantity must be a whole number for unit '" + unit + "'." };
        }
      } else {
        var rounded = Math.round(qty * 1000) / 1000;
        if (Math.abs(qty - rounded) > 0.0001) {
          throw { code: "VALIDATION_ERROR", message: "Quantity can have at most 3 decimal places for unit '" + unit + "'." };
        }
      }

      var prevQty = Number(found.record.stock_quantity) || 0;
      var newQty = prevQty;
      var changeQty = 0;

      if (adjType === "set" || adjType === "correction") {
        newQty = qty;
        changeQty = newQty - prevQty;
      } else if (adjType === "increase" || adjType === "restock") {
        changeQty = qty;
        newQty = prevQty + qty;
      } else if (adjType === "decrease" || adjType === "damage") {
        changeQty = -Math.abs(qty);
        newQty = prevQty - Math.abs(qty);
      }

      if (newQty < 0) {
        throw { code: "VALIDATION_ERROR", message: "Stock quantity cannot become negative." };
      }

      var now = new Date().toISOString();
      var adjId = Database.generateUuid();

      var adjRecord = {
        adjustment_id: adjId,
        product_id: productId,
        adjustment_type: adjType,
        quantity_change: changeQty,
        previous_stock: prevQty,
        new_stock: newQty,
        reason: reason,
        notes: payload.notes ? String(payload.notes).trim() : "",
        actor: payload.actor ? String(payload.actor).trim() : "",
        idempotency_key: idempKey,
        created_at: now
      };

      var adjHeaders = Config.SCHEMA.find(function (s) {
        return s.name === "InventoryAdjustments";
      }).headers;

      // Write audit record FIRST (safer order: ledger evidence before mutation)
      Database.appendRecord(adjSheet, adjRecord, adjHeaders);

      var prodUpdates = {
        stock_quantity: newQty,
        updated_at: now
      };
      Database.updateRecord(prodSheet, found.rowIndex, prodUpdates);

      for (var u in prodUpdates) {
        found.record[u] = prodUpdates[u];
      }

      return {
        product: normalizeProduct(found.record),
        adjustment: normalizeAdjustment(adjRecord)
      };
    });
  }

  function handleInventoryAdjustmentsList(payload) {
    var ss = Database.getSpreadsheet();
    var adjSheet = ss.getSheetByName("InventoryAdjustments");
    if (!adjSheet) return [];

    var allAdj = Database.getAllRecords(adjSheet);
    var filterId = payload && payload.product_id ? String(payload.product_id).trim() : null;
    var results = [];

    for (var i = 0; i < allAdj.length; i++) {
      var r = allAdj[i].record;
      if (!filterId || String(r.product_id) === filterId) {
        results.push(normalizeAdjustment(r));
      }
    }

    results.sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return results;
  }

  // ─── Sales Normalization Helpers ──────────────────────────────

  function normalizeSale(rec) {
    return {
      sale_id: String(rec.sale_id || ""),
      receipt_number: String(rec.receipt_number || ""),
      customer_id: rec.customer_id ? String(rec.customer_id) : null,
      transaction_date: String(rec.transaction_date || ""),
      transaction_date_bs: String(rec.transaction_date_bs || ""),
      subtotal: Number(rec.subtotal) || 0,
      discount_amount: Number(rec.discount_amount) || 0,
      total_amount: Number(rec.total_amount) || 0,
      status: String(rec.status || "completed"),
      payment_method: String(rec.payment_method || "cash"),
      idempotency_key: String(rec.idempotency_key || ""),
      created_at: String(rec.created_at || ""),
      updated_at: String(rec.updated_at || "")
    };
  }

  function normalizeSaleItem(rec) {
    return {
      sale_item_id: String(rec.sale_item_id || ""),
      sale_id: String(rec.sale_id || ""),
      product_id: String(rec.product_id || ""),
      product_name_snapshot: String(rec.product_name_snapshot || ""),
      sku_snapshot: rec.sku_snapshot ? String(rec.sku_snapshot) : null,
      unit_snapshot: String(rec.unit_snapshot || "piece"),
      quantity: Number(rec.quantity) || 0,
      unit_price_snapshot: Number(rec.unit_price_snapshot) || 0,
      line_total: Number(rec.line_total) || 0
    };
  }

  function normalizePayment(rec) {
    return {
      payment_id: String(rec.payment_id || ""),
      sale_id: rec.sale_id ? String(rec.sale_id) : null,
      customer_id: rec.customer_id ? String(rec.customer_id) : null,
      payment_type: String(rec.payment_type || "sale"),
      payment_method: String(rec.payment_method || "cash"),
      amount: Number(rec.amount) || 0,
      payment_status: String(rec.payment_status || "completed"),
      provider_reference: rec.provider_reference ? String(rec.provider_reference) : null,
      created_at: String(rec.created_at || ""),
      updated_at: String(rec.updated_at || "")
    };
  }

  /**
   * Generates a receipt number: REC-YYYYMMDD-NNNN
   * Counts existing sales for the same date and increments.
   */
  function generateReceiptNumber(salesSheet, dateStr) {
    var dateTag = dateStr.replace(/-/g, "");
    var prefix = "REC-" + dateTag + "-";
    var count = 0;

    if (salesSheet) {
      var allSales = Database.getAllRecords(salesSheet);
      for (var i = 0; i < allSales.length; i++) {
        var rn = String(allSales[i].record.receipt_number || "");
        if (rn.indexOf(prefix) === 0) {
          count++;
        }
      }
    }

    var seq = String(count + 1);
    while (seq.length < 4) {
      seq = "0" + seq;
    }
    return prefix + seq;
  }

  // ─── Sale Create ────────────────────────────────────────────

  function handleSaleCreate(payload) {
    if (!payload || typeof payload !== "object") {
      throw { code: "VALIDATION_ERROR", message: "Missing sale payload." };
    }

    var idempKey = payload.idempotency_key ? String(payload.idempotency_key).trim() : "";
    if (!idempKey) {
      throw { code: "VALIDATION_ERROR", message: "Field 'idempotency_key' is required for sale creation." };
    }

    var items = payload.items;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw { code: "VALIDATION_ERROR", message: "Sale must contain at least one item." };
    }

    var discountAmount = Number(payload.discount_amount) || 0;
    if (discountAmount < 0 || !Number.isInteger(discountAmount)) {
      throw { code: "VALIDATION_ERROR", message: "Discount amount must be a non-negative integer in Paisa." };
    }

    var customerId = payload.customer_id ? String(payload.customer_id).trim() : null;
    var actor = payload.actor ? String(payload.actor).trim() : "";

    var ss = Database.getSpreadsheet();
    var salesSheet = ss.getSheetByName("Sales");
    if (!salesSheet) {
      Schema.initializeDatabase(ss);
      salesSheet = ss.getSheetByName("Sales");
    }
    var saleItemsSheet = ss.getSheetByName("SaleItems");
    if (!saleItemsSheet) {
      Schema.initializeDatabase(ss);
      saleItemsSheet = ss.getSheetByName("SaleItems");
    }
    var paymentsSheet = ss.getSheetByName("Payments");
    if (!paymentsSheet) {
      Schema.initializeDatabase(ss);
      paymentsSheet = ss.getSheetByName("Payments");
    }
    var prodSheet = ss.getSheetByName("Products");
    if (!prodSheet) {
      throw { code: "RECORD_NOT_FOUND", message: "Products sheet not found." };
    }
    var adjSheet = ss.getSheetByName("InventoryAdjustments");
    if (!adjSheet) {
      Schema.initializeDatabase(ss);
      adjSheet = ss.getSheetByName("InventoryAdjustments");
    }

    return Database.withLock(15000, function () {
      // 1. Idempotency check on Sales sheet
      var allSaleRecords = Database.getAllRecords(salesSheet);
      var foundExistingIndex = -1;
      var existingSaleRow = null;
      for (var ec = 0; ec < allSaleRecords.length; ec++) {
        var existingKey = String(allSaleRecords[ec].record.idempotency_key || "").trim();
        if (existingKey && existingKey === idempKey) {
          foundExistingIndex = allSaleRecords[ec].rowIndex;
          existingSaleRow = allSaleRecords[ec].record;
          break;
        }
      }

      if (existingSaleRow) {
        var cachedSale = normalizeSale(existingSaleRow);
        var cachedItems = [];
        var allSaleItems = Database.getAllRecords(saleItemsSheet);
        for (var ci = 0; ci < allSaleItems.length; ci++) {
          if (String(allSaleItems[ci].record.sale_id) === cachedSale.sale_id) {
            cachedItems.push(normalizeSaleItem(allSaleItems[ci].record));
          }
        }

        var cachedPayment = null;
        if (paymentsSheet) {
          var allPayments = Database.getAllRecords(paymentsSheet);
          for (var pi = 0; pi < allPayments.length; pi++) {
            if (String(allPayments[pi].record.sale_id) === cachedSale.sale_id) {
              cachedPayment = normalizePayment(allPayments[pi].record);
              break;
            }
          }
        }

        // Partial failure self-healing: if sale was pending, reconcile inventory deductions and payment
        if (cachedSale.status === "pending") {
          var allAdjs = Database.getAllRecords(adjSheet);
          var processedAdjKeys = {};
          for (var ai = 0; ai < allAdjs.length; ai++) {
            var adjK = String(allAdjs[ai].record.idempotency_key || "");
            if (adjK) processedAdjKeys[adjK] = true;
          }

          var prodRows = Database.getAllRecords(prodSheet);
          var prodMap = {};
          for (var pr = 0; pr < prodRows.length; pr++) {
            prodMap[String(prodRows[pr].record.product_id)] = prodRows[pr];
          }

          for (var ci2 = 0; ci2 < cachedItems.length; ci2++) {
            var cItem = cachedItems[ci2];
            var itemAdjKey = idempKey + ":" + cItem.product_id;
            if (!processedAdjKeys[itemAdjKey]) {
              var prodEntry = prodMap[cItem.product_id];
              if (prodEntry) {
                var pStock = Number(prodEntry.record.stock_quantity) || 0;
                var nStock = pStock - cItem.quantity;
                var aHeaders = Config.SCHEMA.find(function (s) { return s.name === "InventoryAdjustments"; }).headers;
                Database.appendRecord(adjSheet, {
                  adjustment_id: Database.generateUuid(),
                  product_id: cItem.product_id,
                  adjustment_type: "decrease",
                  quantity_change: -cItem.quantity,
                  previous_stock: pStock,
                  new_stock: nStock,
                  reason: "Sale " + cachedSale.receipt_number,
                  notes: "Partial failure reconciliation",
                  actor: actor,
                  idempotency_key: itemAdjKey,
                  created_at: new Date().toISOString()
                }, aHeaders);

                Database.updateRecord(prodSheet, prodEntry.rowIndex, {
                  stock_quantity: nStock,
                  updated_at: new Date().toISOString()
                });
              }
            }
          }

          if (!cachedPayment && paymentsSheet) {
            var payHeaders = Config.SCHEMA.find(function (s) { return s.name === "Payments"; }).headers;
            var newPayRec = {
              payment_id: Database.generateUuid(),
              sale_id: cachedSale.sale_id,
              customer_id: cachedSale.customer_id || "",
              payment_type: "sale",
              payment_method: "cash",
              amount: cachedSale.total_amount,
              payment_status: "completed",
              provider_reference: "CASH-REGISTER",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            Database.appendRecord(paymentsSheet, newPayRec, payHeaders);
            cachedPayment = normalizePayment(newPayRec);
          }

          Database.updateRecord(salesSheet, foundExistingIndex, {
            status: "completed",
            updated_at: new Date().toISOString()
          });
          cachedSale.status = "completed";
        }

        return {
          sale: cachedSale,
          items: cachedItems,
          payment: cachedPayment
        };
      }

      // 2. Fetch and validate all products referenced in items
      var allProducts = Database.getAllRecords(prodSheet);
      var productMap = {};
      for (var pm = 0; pm < allProducts.length; pm++) {
        productMap[String(allProducts[pm].record.product_id)] = allProducts[pm];
      }

      var validatedItems = [];
      var subtotal = 0;

      for (var it = 0; it < items.length; it++) {
        var item = items[it];
        var productId = item.product_id ? String(item.product_id).trim() : "";
        if (!productId) {
          throw { code: "VALIDATION_ERROR", message: "Item #" + (it + 1) + " requires a product_id." };
        }

        var productEntry = productMap[productId];
        if (!productEntry) {
          throw { code: "RECORD_NOT_FOUND", message: "Product '" + productId + "' not found." };
        }
        var productRec = productEntry.record;

        // Check product is active
        var isActive = productRec.is_active === true || String(productRec.is_active).toUpperCase() === "TRUE";
        if (!isActive) {
          throw { code: "VALIDATION_ERROR", message: "Product '" + String(productRec.name) + "' is inactive and cannot be sold." };
        }

        var qty = Number(item.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw { code: "VALIDATION_ERROR", message: "Item #" + (it + 1) + " quantity must be a positive number." };
        }

        // Unit validation: piece-based units reject fractional quantities
        var unit = String(productRec.unit || "").trim().toLowerCase();
        var isDiscrete = unit === "piece" || unit === "packet" || unit === "bottle";
        if (isDiscrete) {
          if (Math.floor(qty) !== qty) {
            throw { code: "VALIDATION_ERROR", message: "Quantity must be a whole number for unit '" + unit + "' (Product: " + String(productRec.name) + ")." };
          }
        } else {
          var rounded = Math.round(qty * 1000) / 1000;
          if (Math.abs(qty - rounded) > 0.0001) {
            throw { code: "VALIDATION_ERROR", message: "Quantity can have at most 3 decimal places for unit '" + unit + "'." };
          }
        }

        // Check sufficient stock
        var currentStock = Number(productRec.stock_quantity) || 0;
        if (qty > currentStock) {
          throw {
            code: "VALIDATION_ERROR",
            message: "Insufficient stock for '" + String(productRec.name) + "'. Available: " + currentStock + ", requested: " + qty + "."
          };
        }

        // Server-authoritative unit price: strictly catalog selling_price (never trust client)
        var unitPrice = Number(productRec.selling_price) || 0;

        // Compute line total in integer Paisa
        var lineTotal = Math.round(unitPrice * qty);

        validatedItems.push({
          product_id: productId,
          product_name: String(productRec.name || ""),
          sku: productRec.sku ? String(productRec.sku).trim() : "",
          unit: unit,
          quantity: qty,
          unit_price: unitPrice,
          line_total: lineTotal,
          product_entry: productEntry
        });

        subtotal += lineTotal;
      }

      // 3. Compute totals
      var totalAmount = Math.max(0, subtotal - discountAmount);

      // 4. Generate IDs and receipt number
      var saleId = Database.generateUuid();
      var now = new Date();
      var nowIso = now.toISOString();

      // Dual date: Gregorian YYYY-MM-DD
      var y = now.getUTCFullYear();
      var mon = String(now.getUTCMonth() + 1);
      if (mon.length < 2) mon = "0" + mon;
      var day = String(now.getUTCDate());
      if (day.length < 2) day = "0" + day;
      var transactionDate = y + "-" + mon + "-" + day;

      var transactionDateBs = gregorianToBikramSambatGAS(now);
      var receiptNumber = generateReceiptNumber(salesSheet, transactionDate);

      // 5. Write sale header initially in "pending" status (audit-first durability)
      var salesHeaders = Config.SCHEMA.find(function (s) { return s.name === "Sales"; }).headers;
      var saleRecord = {
        sale_id: saleId,
        receipt_number: receiptNumber,
        customer_id: customerId || "",
        transaction_date: transactionDate,
        transaction_date_bs: transactionDateBs,
        subtotal: subtotal,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        status: "pending",
        payment_method: "cash",
        idempotency_key: idempKey,
        created_at: nowIso,
        updated_at: nowIso
      };
      Database.appendRecord(salesSheet, saleRecord, salesHeaders);

      // Get the row index of the newly inserted sale for later status transition
      var allSalesAfterInsert = Database.getAllRecords(salesSheet);
      var newSaleRowIndex = -1;
      for (var si = allSalesAfterInsert.length - 1; si >= 0; si--) {
        if (allSalesAfterInsert[si].record.sale_id === saleId) {
          newSaleRowIndex = allSalesAfterInsert[si].rowIndex;
          break;
        }
      }

      // 6. Write line items and deduct stock
      var saleItemHeaders = Config.SCHEMA.find(function (s) { return s.name === "SaleItems"; }).headers;
      var adjHeaders = Config.SCHEMA.find(function (s) { return s.name === "InventoryAdjustments"; }).headers;
      var normalizedItems = [];

      for (var vi = 0; vi < validatedItems.length; vi++) {
        var vItem = validatedItems[vi];
        var saleItemId = Database.generateUuid();

        var saleItemRecord = {
          sale_item_id: saleItemId,
          sale_id: saleId,
          product_id: vItem.product_id,
          product_name_snapshot: vItem.product_name,
          sku_snapshot: vItem.sku,
          unit_snapshot: vItem.unit,
          quantity: vItem.quantity,
          unit_price_snapshot: vItem.unit_price,
          line_total: vItem.line_total
        };
        Database.appendRecord(saleItemsSheet, saleItemRecord, saleItemHeaders);
        normalizedItems.push(normalizeSaleItem(saleItemRecord));

        // Deduct stock from product
        var prevStock = Number(vItem.product_entry.record.stock_quantity) || 0;
        var newStock = prevStock - vItem.quantity;

        // Write audit record FIRST
        var adjId = Database.generateUuid();
        var adjRecord = {
          adjustment_id: adjId,
          product_id: vItem.product_id,
          adjustment_type: "decrease",
          quantity_change: -vItem.quantity,
          previous_stock: prevStock,
          new_stock: newStock,
          reason: "Sale " + receiptNumber,
          notes: "",
          actor: actor,
          idempotency_key: idempKey + ":" + vItem.product_id,
          created_at: nowIso
        };
        Database.appendRecord(adjSheet, adjRecord, adjHeaders);

        // Update product stock
        Database.updateRecord(prodSheet, vItem.product_entry.rowIndex, {
          stock_quantity: newStock,
          updated_at: nowIso
        });
      }

      // 7. Write payment record to Payments sheet
      var paymentHeaders = Config.SCHEMA.find(function (s) { return s.name === "Payments"; }).headers;
      var paymentId = Database.generateUuid();
      var paymentRecord = {
        payment_id: paymentId,
        sale_id: saleId,
        customer_id: customerId || "",
        payment_type: "sale",
        payment_method: "cash",
        amount: totalAmount,
        payment_status: "completed",
        provider_reference: "CASH-REGISTER",
        created_at: nowIso,
        updated_at: nowIso
      };
      Database.appendRecord(paymentsSheet, paymentRecord, paymentHeaders);

      // 8. Transition sale status to completed
      if (newSaleRowIndex !== -1) {
        Database.updateRecord(salesSheet, newSaleRowIndex, {
          status: "completed",
          updated_at: new Date().toISOString()
        });
      }
      saleRecord.status = "completed";

      return {
        sale: normalizeSale(saleRecord),
        items: normalizedItems,
        payment: normalizePayment(paymentRecord)
      };
    });
  }

  /**
   * Simplified Gregorian -> Bikram Sambat converter for GAS runtime.
   * Covers 2076–2092 BS (approx 2020–2035 AD).
   */
  function gregorianToBikramSambatGAS(dateObj) {
    var BS_MONTH_DAYS = {
      2076: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
      2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
      2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
      2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
      2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
      2081: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 31],
      2082: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
      2083: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
      2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 31],
      2085: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
      2086: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
      2087: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
      2088: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
      2089: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
      2090: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
      2091: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
      2092: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30]
    };

    // Anchor: 2020-04-13 AD = 2077-01-01 BS
    var anchorTime = new Date(Date.UTC(2020, 3, 13)).getTime();
    var targetTime = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate())).getTime();
    var diffDays = Math.floor((targetTime - anchorTime) / (1000 * 60 * 60 * 24));

    var currentYear = 2077;
    var currentMonth = 1;
    var currentDay = 1;

    if (diffDays >= 0) {
      while (diffDays > 0) {
        var daysInMonth = (BS_MONTH_DAYS[currentYear] || BS_MONTH_DAYS[2083])[currentMonth - 1];
        var remaining = daysInMonth - currentDay + 1;
        if (diffDays >= remaining) {
          diffDays -= remaining;
          currentDay = 1;
          currentMonth++;
          if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
          }
        } else {
          currentDay += diffDays;
          diffDays = 0;
        }
      }
    } else {
      diffDays = Math.abs(diffDays);
      while (diffDays > 0) {
        if (diffDays < currentDay) {
          currentDay -= diffDays;
          diffDays = 0;
        } else {
          diffDays -= currentDay;
          currentMonth--;
          if (currentMonth < 1) {
            currentMonth = 12;
            currentYear--;
          }
          var dm = (BS_MONTH_DAYS[currentYear] || BS_MONTH_DAYS[2077])[currentMonth - 1];
          currentDay = dm;
        }
      }
    }

    var mm = String(currentMonth);
    if (mm.length < 2) mm = "0" + mm;
    var dd = String(currentDay);
    if (dd.length < 2) dd = "0" + dd;
    return currentYear + "-" + mm + "-" + dd;
  }

  // ─── Sale Get ───────────────────────────────────────────────

  function handleSaleGet(payload) {
    if (!payload || !payload.sale_id) {
      throw { code: "VALIDATION_ERROR", message: "Field 'sale_id' is required." };
    }

    var saleId = String(payload.sale_id).trim();
    var ss = Database.getSpreadsheet();
    var salesSheet = ss.getSheetByName("Sales");
    if (!salesSheet) {
      throw { code: "RECORD_NOT_FOUND", message: "Sales sheet not found." };
    }

    var found = Database.findRecordByField(salesSheet, "sale_id", saleId);
    if (!found) {
      throw { code: "RECORD_NOT_FOUND", message: "Sale with ID '" + saleId + "' not found." };
    }

    var saleItemsSheet = ss.getSheetByName("SaleItems");
    var saleItems = [];
    if (saleItemsSheet) {
      var allItems = Database.getAllRecords(saleItemsSheet);
      for (var i = 0; i < allItems.length; i++) {
        if (String(allItems[i].record.sale_id) === saleId) {
          saleItems.push(normalizeSaleItem(allItems[i].record));
        }
      }
    }

    return {
      sale: normalizeSale(found.record),
      items: saleItems
    };
  }

  // ─── Sales List ─────────────────────────────────────────────

  function handleSalesList(payload) {
    var ss = Database.getSpreadsheet();
    var salesSheet = ss.getSheetByName("Sales");
    if (!salesSheet) return [];

    var allSales = Database.getAllRecords(salesSheet);
    var sales = [];
    for (var i = 0; i < allSales.length; i++) {
      sales.push(normalizeSale(allSales[i].record));
    }

    var filter = payload || {};

    // Date range filtering
    if (filter.start_date) {
      var sd = String(filter.start_date);
      sales = sales.filter(function (s) { return s.transaction_date >= sd; });
    }
    if (filter.end_date) {
      var ed = String(filter.end_date);
      sales = sales.filter(function (s) { return s.transaction_date <= ed; });
    }

    // Customer ID filter
    if (filter.customer_id) {
      var cid = String(filter.customer_id);
      sales = sales.filter(function (s) { return s.customer_id === cid; });
    }

    // Status filter
    if (filter.status) {
      var st = String(filter.status).toLowerCase();
      sales = sales.filter(function (s) { return s.status.toLowerCase() === st; });
    }

    // Sort by created_at descending
    sales.sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Pagination
    var page = Math.max(1, Number(filter.page) || 1);
    var limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    var start = (page - 1) * limit;
    return sales.slice(start, start + limit);
  }

  return {
    handleHealth: handleHealth,
    handleSchemaStatus: handleSchemaStatus,
    handleInitDatabase: handleInitDatabase,
    handleTestRecordCreate: handleTestRecordCreate,
    handleTestRecordGet: handleTestRecordGet,
    handleTestRecordCleanup: handleTestRecordCleanup,
    handleProductsList: handleProductsList,
    handleProductCreate: handleProductCreate,
    handleProductGet: handleProductGet,
    handleProductUpdate: handleProductUpdate,
    handleProductAdjustStock: handleProductAdjustStock,
    handleInventoryAdjustmentsList: handleInventoryAdjustmentsList,
    handleSaleCreate: handleSaleCreate,
    handleSaleGet: handleSaleGet,
    handleSalesList: handleSalesList
  };
})();
