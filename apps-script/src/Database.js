/**
 * Spreadsheet Access and Concurrency Helpers.
 * Implements header-based column mapping and LockService safety.
 */

var Database = (function () {
  function getSpreadsheet() {
    var id = Config.getSpreadsheetId();
    if (id && id.trim().length > 0) {
      try {
        return SpreadsheetApp.openById(id.trim());
      } catch (e) {
        throw {
          code: "DATABASE_NOT_CONFIGURED",
          message: "Unable to open Google Spreadsheet with ID '" + id + "': " + e.message
        };
      }
    }

    try {
      var active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) return active;
    } catch (e) {
      // Ignored
    }

    throw {
      code: "DATABASE_NOT_CONFIGURED",
      message: "No Google Spreadsheet ID configured. Set SPREADSHEET_ID in Apps Script Script Properties."
    };
  }

  function withLock(timeoutMs, callback) {
    var lock = LockService.getScriptLock();
    var waitTime = timeoutMs || 10000;
    var acquired = lock.tryLock(waitTime);

    if (!acquired) {
      throw {
        code: "TIMEOUT_ERROR",
        message: "Failed to acquire script lock within " + (waitTime / 1000) + " seconds. Concurrent write in progress."
      };
    }

    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function getHeaderMap(sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return {};

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).trim();
      if (h) {
        map[h] = i + 1; // 1-based index
      }
    }
    return map;
  }

  function appendRecord(sheet, recordObj, headerList) {
    var headerMap = getHeaderMap(sheet);
    var lastCol = sheet.getLastColumn();
    var cols = lastCol > 0 ? lastCol : headerList.length;
    var rowValues = new Array(cols);

    // Initialize all with empty string
    for (var c = 0; c < cols; c++) {
      rowValues[c] = "";
    }

    for (var key in recordObj) {
      if (recordObj.hasOwnProperty(key)) {
        var colIdx = headerMap[key];
        if (colIdx) {
          rowValues[colIdx - 1] = recordObj[key] !== null && recordObj[key] !== undefined ? recordObj[key] : "";
        }
      }
    }

    sheet.appendRow(rowValues);
  }

  function findRecordByField(sheet, fieldName, fieldValue) {
    var headerMap = getHeaderMap(sheet);
    var colIdx = headerMap[fieldName];
    if (!colIdx) return null;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      if (String(row[colIdx - 1]) === String(fieldValue)) {
        var obj = {};
        for (var h = 0; h < headers.length; h++) {
          var headerName = String(headers[h]).trim();
          if (headerName) {
            obj[headerName] = row[h];
          }
        }
        return {
          rowIndex: r + 2, // 1-based spreadsheet row
          record: obj
        };
      }
    }

    return null;
  }

  function deleteRecordsByField(sheet, fieldName, fieldValue) {
    var headerMap = getHeaderMap(sheet);
    var colIdx = headerMap[fieldName];
    if (!colIdx) return 0;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return 0;

    var data = sheet.getRange(2, colIdx, lastRow - 1, 1).getValues();
    var deletedCount = 0;

    // Iterate backwards so row deletions don't shift unexamined indices
    for (var r = data.length - 1; r >= 0; r--) {
      if (String(data[r][0]) === String(fieldValue)) {
        sheet.deleteRow(r + 2);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  function getAllRecords(sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var records = [];

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      var obj = {};
      for (var h = 0; h < headers.length; h++) {
        var headerName = String(headers[h]).trim();
        if (headerName) {
          obj[headerName] = row[h];
        }
      }
      records.push({ rowIndex: r + 2, record: obj });
    }
    return records;
  }

  /**
   * Generates a UUID v4 identifier.
   * Uses Utilities.getUuid() in Google Apps Script; falls back to manual generation.
   */
  function generateUuid() {
    if (typeof Utilities !== "undefined" && typeof Utilities.getUuid === "function") {
      return Utilities.getUuid();
    }
    // Fallback UUID v4 generation for non-GAS environments
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function updateRecord(sheet, rowIndex, updates) {
    var headerMap = getHeaderMap(sheet);
    for (var key in updates) {
      if (updates.hasOwnProperty(key)) {
        var colIdx = headerMap[key];
        if (colIdx) {
          var val = updates[key] !== null && updates[key] !== undefined ? updates[key] : "";
          sheet.getRange(rowIndex, colIdx).setValue(val);
        }
      }
    }
  }

  return {
    getSpreadsheet: getSpreadsheet,
    withLock: withLock,
    getHeaderMap: getHeaderMap,
    appendRecord: appendRecord,
    findRecordByField: findRecordByField,
    deleteRecordsByField: deleteRecordsByField,
    getAllRecords: getAllRecords,
    updateRecord: updateRecord,
    generateUuid: generateUuid
  };
})();
