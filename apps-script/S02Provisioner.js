/* S02 DEV schema provisioner — Apps Script entry points.
 * Deploy to the DEV Sheet-bound Apps Script project alongside:
 *   OutboundGuard.js, S01Probe.js, S02ProvisionerCore.js,
 *   S02SchemaData.js, S02SeedData.js
 * Zero-arg functions: runS02DryRun, runS02Apply, runS02Validate.
 * Schema/seed embedded in S02SchemaData.js and S02SeedData.js.
 * Core logic in S02ProvisionerCore.js (exposes global S02Provisioner).
 * Only S01_CONFIG remains in Script Properties.
 * No triggers, no email, no calendar, no network calls.
 */

function _loadProvisionerConfig() {
  var properties = PropertiesService.getScriptProperties();
  var config = JSON.parse(properties.getProperty('S01_CONFIG') || 'null');

  if (!config || config.environment !== 'DEV') {
    throw new Error('S02_PROVISIONER_REFUSED: S01_CONFIG.environment must be DEV, got ' + (config ? config.environment : 'null'));
  }

  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var configuredSheetId = config.sheetId || null;

  if (!configuredSheetId) {
    throw new Error('S02_PROVISIONER_REFUSED: S01_CONFIG.sheetId is mandatory. Set it to the DEV Sheet ID.');
  }

  if (sheetId !== configuredSheetId) {
    throw new Error('S02_PROVISIONER_REFUSED: sheet identity mismatch. Expected ' + configuredSheetId + ', got ' + sheetId);
  }

  // Schema and config seed are embedded in companion .gs files
  var schema = getS02SchemaDefinition();
  var configSeed = getS02ConfigSeed();

  if (!schema || !schema.tables || schema.tables.length === 0) {
    throw new Error('S02_PROVISIONER_REFUSED: embedded schema is empty or invalid.');
  }

  return {
    config: config,
    sheetId: sheetId,
    configuredSheetId: configuredSheetId,
    schema: schema,
    configSeed: configSeed || null
  };
}

function runS02DryRun() {
  var cfg = _loadProvisionerConfig();
  var adapter = new AppsScriptSheetAdapter();

  var result = S02Provisioner.provisionSchema(cfg.schema, cfg.configSeed, adapter, {
    dryRun: true,
    environment: cfg.config.environment,
    configuredSheetId: cfg.configuredSheetId
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS02Apply() {
  var cfg = _loadProvisionerConfig();
  var adapter = new AppsScriptSheetAdapter();

  var result = S02Provisioner.provisionSchema(cfg.schema, cfg.configSeed, adapter, {
    dryRun: false,
    environment: cfg.config.environment,
    configuredSheetId: cfg.configuredSheetId
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS02Validate() {
  var cfg = _loadProvisionerConfig();
  var adapter = new AppsScriptSheetAdapter();

  var result = S02Provisioner.validateSchema(cfg.schema, cfg.configSeed, adapter);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS02HeaderDiagnostic() {
  var cfg = _loadProvisionerConfig();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var result = {
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    total_sheets: ss.getSheets().length,
    configured_sheet_id: cfg.configuredSheetId,
    tests: []
  };

  var testTabs = ['Companies', 'People', 'Jobs'];
  for (var i = 0; i < testTabs.length; i++) {
    var tabName = testTabs[i];
    var test = { tab: tabName };

    try {
      // Step 1: getActiveSpreadsheet
      var ssFresh = SpreadsheetApp.getActiveSpreadsheet();
      test.ss_fresh = !!ssFresh;
      test.ss_fresh_id = ssFresh ? ssFresh.getId() : null;

      // Step 2: getSheetByName
      var sheet = ssFresh.getSheetByName(tabName);
      test.sheet_found = !!sheet;

      if (!sheet) {
        test.error = 'getSheetByName returned null';
        result.tests.push(test);
        continue;
      }

      // Step 3: sheet metadata
      try { test.sheet_name = sheet.getName(); } catch(e) { test.name_error = e.message; }
      try { test.sheet_id = sheet.getSheetId(); } catch(e) { test.sheetId_error = e.message; }
      try { test.sheet_index = sheet.getIndex(); } catch(e) { test.index_error = e.message; }

      // Step 4: getLastColumn
      try {
        test.last_column = sheet.getLastColumn();
      } catch(e) {
        test.error = 'getLastColumn failed: ' + e.message;
        result.tests.push(test);
        continue;
      }

      // Step 5: getRange
      try {
        var range = sheet.getRange(1, 1, 1, test.last_column);
        test.range_ok = true;
      } catch(e) {
        test.error = 'getRange(1,1,1,' + test.last_column + ') failed: ' + e.message;
        result.tests.push(test);
        continue;
      }

      // Step 6: getValues
      try {
        var values = range.getValues();
        test.values_rows = values.length;
        test.values_cols = values[0] ? values[0].length : 0;
        test.first_cell = values[0] ? String(values[0][0] || '') : '';
      } catch(e) {
        test.error = 'getValues failed: ' + e.message;
        result.tests.push(test);
        continue;
      }

      test.success = true;
    } catch(e) {
      test.error = 'unexpected: ' + (e.message || String(e));
    }

    result.tests.push(test);
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/* Apps Script Sheet adapter — implements the sheetAdapter interface using SpreadsheetApp.
 * Must be bound to the target spreadsheet.
 * Re-acquires the spreadsheet reference per-operation to avoid stale state
 * after programmatic sheet deletion (original S01_Setup gid=0 removed). */

var AppsScriptSheetAdapter = function() {
  // Do NOT cache this.ss in constructor — re-acquire per operation
  // to avoid stale reference after sheets are added/deleted.

  this._getSs = function() {
    return SpreadsheetApp.getActiveSpreadsheet();
  };

  this.getSheetId = function() {
    return this._getSs().getId();
  };

  this.getTabNames = function() {
    return this._getSs().getSheets().map(function(s) { return s.getName(); });
  };

  this.createTab = function(name) {
    var ss = this._getSs();
    var existing = ss.getSheetByName(name);
    if (existing) return;
    ss.insertSheet(name);
  };

  this.getHeaders = function(tabName) {
    try {
      var ss = this._getSs();
      if (!ss) throw new Error('getActiveSpreadsheet returned null');

      var sheet = ss.getSheetByName(tabName);
      if (!sheet) throw new Error('getSheetByName returned null for "' + tabName + '"');

      try { var sheetName = sheet.getName(); } catch(e) { throw new Error('getName failed: ' + e.message); }

      var lastCol;
      try { lastCol = sheet.getLastColumn(); } catch(e) { throw new Error('getLastColumn failed for ' + sheetName + ': ' + e.message); }
      if (lastCol === 0) return [];

      var range;
      try { range = sheet.getRange(1, 1, 1, lastCol); } catch(e) { throw new Error('getRange(1,1,1,' + lastCol + ') failed for ' + sheetName + ': ' + e.message); }

      var values;
      try { values = range.getValues(); } catch(e) { throw new Error('getValues failed for ' + sheetName + ': ' + e.message); }

      if (!values || values.length === 0) return [];
      return values[0].map(function(v) { return String(v || '').trim(); });
    } catch (e) {
      throw new Error('[getHeaders tab=' + tabName + '] ' + (e.message || String(e)));
    }
  };

  this.setHeaders = function(tabName, headers) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);
    var range = sheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
  };

  this.freezeHeaderRow = function(tabName) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    sheet.setFrozenRows(1);
  };

  this.applyTextFormat = function(tabName, columnNames) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    var headers = this.getHeaders(tabName);
    for (var i = 0; i < columnNames.length; i++) {
      var colIdx = -1;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j].toLowerCase() === columnNames[i].toLowerCase()) {
          colIdx = j;
          break;
        }
      }
      if (colIdx >= 0) {
        var maxRows = Math.max(sheet.getMaxRows(), 2);
        var range = sheet.getRange(2, colIdx + 1, maxRows - 1, 1);
        range.setNumberFormat('@');
      }
    }
  };

  this.getData = function(tabName) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];
    var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    return range.getValues();
  };

  this.insertRow = function(tabName, values) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);
    var lastRow = sheet.getLastRow();
    var targetRow = lastRow + 1;
    var range = sheet.getRange(targetRow, 1, 1, values.length);
    range.setValues([values]);
  };

  this.deleteTab = function(tabName) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    ss.deleteSheet(sheet);
  };

  this.checkTextFormat = function(tabName, columnNames) {
    var ss = this._getSs();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return { notFormatted: columnNames };
    var headers = this.getHeaders(tabName);
    var notFormatted = [];
    for (var i = 0; i < columnNames.length; i++) {
      var colIdx = -1;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j].toLowerCase() === columnNames[i].toLowerCase()) {
          colIdx = j;
          break;
        }
      }
      if (colIdx >= 0) {
        // Only check format if there are data rows (row 2+)
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var range = sheet.getRange(2, colIdx + 1);
          var format = range.getNumberFormat();
          if (format !== '@') {
            notFormatted.push(columnNames[i]);
          }
        }
      }
    }
    return { notFormatted: notFormatted };
  };
};
