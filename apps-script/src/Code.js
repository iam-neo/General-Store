/**
 * Google Apps Script Web App Entry Points and Standalone Operators.
 * General Store Management System — Phase 4 Backend Foundation.
 */

/**
 * Standard HTTP GET entry point for Web App.
 * Safe read-only inspection (e.g. health check).
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "health";
    var result;

    if (action === "health") {
      result = Handlers.handleHealth();
    } else {
      return jsonResponse({
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "GET requests only support action=health. Use POST for authenticated operations."
        }
      });
    }

    return jsonResponse({
      success: true,
      data: result,
      error: null
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Standard HTTP POST entry point for Web App.
 * Dispatches authenticated backend actions.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body cannot be empty. Send a valid JSON payload."
        }
      });
    }

    // Size check: reject payloads over 500KB
    if (e.postData.contents.length > 500000) {
      return jsonResponse({
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Payload size exceeds maximum allowed limit of 500KB."
        }
      });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Malformed JSON in request body: " + parseErr.message
        }
      });
    }

    // Authenticate request
    var authCheck = Auth.verifyRequest(body, e ? e.headers : null);
    if (!authCheck.valid) {
      return jsonResponse({
        success: false,
        data: null,
        error: authCheck.error
      });
    }

    var action = body.action ? String(body.action).trim() : "";
    var payload = body.payload || {};
    var data;

    switch (action) {
      case "health":
        data = Handlers.handleHealth();
        break;

      case "schema_status":
        data = Handlers.handleSchemaStatus();
        break;

      case "init_database":
        data = Handlers.handleInitDatabase();
        break;

      case "test_record_create":
        data = Handlers.handleTestRecordCreate(payload);
        break;

      case "test_record_get":
        data = Handlers.handleTestRecordGet(payload);
        break;

      case "test_record_cleanup":
        data = Handlers.handleTestRecordCleanup(payload);
        break;

      case "products_list":
        data = Handlers.handleProductsList(payload);
        break;

      case "product_create":
        data = Handlers.handleProductCreate(payload);
        break;

      case "product_get":
        data = Handlers.handleProductGet(payload);
        break;

      case "product_update":
        data = Handlers.handleProductUpdate(payload);
        break;

      case "product_adjust_stock":
        data = Handlers.handleProductAdjustStock(payload);
        break;

      case "inventory_adjustments_list":
        data = Handlers.handleInventoryAdjustmentsList(payload);
        break;

      case "sale_create":
        data = Handlers.handleSaleCreate(payload);
        break;

      case "sale_get":
        data = Handlers.handleSaleGet(payload);
        break;

      case "sales_list":
        data = Handlers.handleSalesList(payload);
        break;

      default:
        return jsonResponse({
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Unsupported action '" + action + "'."
          }
        });
    }

    return jsonResponse({
      success: true,
      data: data,
      error: null
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Normalizes output into ContentService JSON text.
 */
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Centralized exception handler that logs diagnostic info without leaking secrets.
 */
function handleError(err) {
  var errorCode = "INTERNAL_ERROR";
  var errorMessage = "An unexpected error occurred while executing the Apps Script backend.";

  if (err && typeof err === "object") {
    if (err.code && err.message) {
      errorCode = err.code;
      errorMessage = err.message;
    } else if (err.message) {
      errorMessage = err.message;
    }
  } else if (typeof err === "string") {
    errorMessage = err;
  }

  // Safe server-side diagnostic logging (never log secret tokens)
  console.error("Apps Script Error [" + errorCode + "]: " + errorMessage);

  return jsonResponse({
    success: false,
    data: null,
    error: {
      code: errorCode,
      message: errorMessage
    }
  });
}

// =========================================================================
// MANUAL EXECUTION FUNCTIONS FOR APPS SCRIPT IDE
// (Authorized store operators can run these from the Apps Script code editor)
// =========================================================================

/**
 * Run this function directly from the Apps Script editor to initialize the Google Sheet database.
 */
function initDatabase() {
  var result = Handlers.handleInitDatabase();
  Logger.log("=== DATABASE INITIALIZATION RESULT ===");
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Run this function from the Apps Script editor to verify schema status.
 */
function checkSchema() {
  var result = Handlers.handleSchemaStatus();
  Logger.log("=== SCHEMA COMPATIBILITY STATUS ===");
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Run this function from the Apps Script editor to test backend execution.
 */
function runHealthCheck() {
  var result = Handlers.handleHealth();
  Logger.log("=== HEALTH CHECK ===");
  Logger.log(JSON.stringify(result, null, 2));
}
