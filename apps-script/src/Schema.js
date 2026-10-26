/**
 * Idempotent Database Initialization and Schema Inspection.
 * Inspects required sheets and headers without destroying existing data.
 */

var Schema = (function () {
  function inspectSchema(spreadsheet) {
    var reports = [];
    var allCompatible = true;
    var schemaList = Config.SCHEMA;

    for (var i = 0; i < schemaList.length; i++) {
      var def = schemaList[i];
      var sheet = spreadsheet.getSheetByName(def.name);

      if (!sheet) {
        allCompatible = false;
        reports.push({
          name: def.name,
          exists: false,
          status: "missing_sheet",
          expectedHeaders: def.headers,
          actualHeaders: [],
          missingHeaders: def.headers,
          extraHeaders: [],
          rowCount: 0
        });
        continue;
      }

      var lastCol = sheet.getLastColumn();
      var actualHeaders = [];
      if (lastCol > 0) {
        var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        for (var h = 0; h < rawHeaders.length; h++) {
          var val = String(rawHeaders[h]).trim();
          if (val) actualHeaders.push(val);
        }
      }

      var normalizedActual = actualHeaders.map(function (item) {
        return item.toLowerCase();
      });

      var missingHeaders = def.headers.filter(function (header) {
        return normalizedActual.indexOf(header.toLowerCase()) === -1;
      });

      var normalizedExpected = def.headers.map(function (item) {
        return item.toLowerCase();
      });

      var extraHeaders = actualHeaders.filter(function (header) {
        return normalizedExpected.indexOf(header.toLowerCase()) === -1;
      });

      var status = "ok";
      if (actualHeaders.length === 0) {
        status = "empty_sheet";
        allCompatible = false;
      } else if (missingHeaders.length > 0) {
        status = "header_mismatch";
        allCompatible = false;
      }

      var lastRow = sheet.getLastRow();
      var rowCount = lastRow > 1 ? lastRow - 1 : 0;

      reports.push({
        name: def.name,
        exists: true,
        status: status,
        expectedHeaders: def.headers,
        actualHeaders: actualHeaders,
        missingHeaders: missingHeaders,
        extraHeaders: extraHeaders,
        rowCount: rowCount
      });
    }

    return {
      isCompatible: allCompatible,
      sheets: reports,
      checkedAt: new Date().toISOString()
    };
  }

  function initializeDatabase(spreadsheet) {
    return Database.withLock(20000, function () {
      var actions = [];
      var schemaList = Config.SCHEMA;

      for (var i = 0; i < schemaList.length; i++) {
        var def = schemaList[i];
        var sheet = spreadsheet.getSheetByName(def.name);

        if (!sheet) {
          sheet = spreadsheet.insertSheet(def.name);
          var headerRange = sheet.getRange(1, 1, 1, def.headers.length);
          headerRange.setValues([def.headers]);
          headerRange.setFontWeight("bold");
          sheet.setFrozenRows(1);
          actions.push("Created sheet '" + def.name + "' and configured " + def.headers.length + " headers.");
        } else {
          var lastCol = sheet.getLastColumn();
          var lastRow = sheet.getLastRow();

          if (lastCol === 0 || lastRow === 0) {
            var emptyRange = sheet.getRange(1, 1, 1, def.headers.length);
            emptyRange.setValues([def.headers]);
            emptyRange.setFontWeight("bold");
            sheet.setFrozenRows(1);
            actions.push("Configured headers for empty sheet '" + def.name + "'.");
          } else {
            // Sheet has existing data: safely append any missing headers to the end without overwriting
            var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
              return String(h).trim();
            });
            var normalizedExisting = existingHeaders.map(function (h) {
              return h.toLowerCase();
            });

            var missing = def.headers.filter(function (h) {
              return normalizedExisting.indexOf(h.toLowerCase()) === -1;
            });

            if (missing.length > 0) {
              for (var m = 0; m < missing.length; m++) {
                var newColIndex = lastCol + m + 1;
                var cell = sheet.getRange(1, newColIndex);
                cell.setValue(missing[m]);
                cell.setFontWeight("bold");
              }
              actions.push("Appended " + missing.length + " missing header(s) to existing sheet '" + def.name + "': " + missing.join(", "));
            } else {
              actions.push("Verified existing sheet '" + def.name + "' is compatible (" + lastCol + " columns, " + (lastRow > 1 ? lastRow - 1 : 0) + " records).");
            }
          }
        }
      }

      var finalStatus = inspectSchema(spreadsheet);

      return {
        initialized: true,
        actions: actions,
        schemaStatus: finalStatus,
        timestamp: new Date().toISOString()
      };
    });
  }

  return {
    inspectSchema: inspectSchema,
    initializeDatabase: initializeDatabase
  };
})();
