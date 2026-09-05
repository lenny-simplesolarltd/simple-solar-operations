/* S02 DEV schema provisioner — Apps Script entry points.
 * Deploy to the DEV Sheet-bound Apps Script project alongside OutboundGuard and S01Probe.
 * Zero-arg functions: runS02DryRun, runS02Apply, runS02Validate.
 * No triggers, no email, no calendar, no network calls.
 */

function _loadProvisionerConfig() {
  var properties = PropertiesService.getScriptProperties();
  var config = JSON.parse(properties.getProperty('S01_CONFIG') || 'null');

  if (!config || config.environment !== 'DEV') {
    throw new Error('S02_PROVISIONER_REFUSED: S01_CONFIG.environment must be DEV, got ' + (config ? config.environment : 'null'));
  }

  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var configuredSheetId = config.sheetId || config.spreadsheetId || null;

  if (!configuredSheetId) {
    throw new Error('S02_PROVISIONER_REFUSED: S01_CONFIG.sheetId is mandatory. Set it to the DEV Sheet ID.');
  }

  if (sheetId !== configuredSheetId) {
    throw new Error('S02_PROVISIONER_REFUSED: sheet identity mismatch. Expected ' + configuredSheetId + ', got ' + sheetId);
  }

  var schemaJson = properties.getProperty('S02_SCHEMA');
  if (!schemaJson) {
    throw new Error('S02_PROVISIONER_REFUSED: S02_SCHEMA property not set. Paste schema/tables.json content.');
  }

  var configJson = properties.getProperty('S02_CONFIG_SEED');

  return {
    config: config,
    sheetId: sheetId,
    configuredSheetId: configuredSheetId,
    schema: JSON.parse(schemaJson),
    configSeed: configJson ? JSON.parse(configJson) : null
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
  var properties = PropertiesService.getScriptProperties();
  var schemaJson = properties.getProperty('S02_SCHEMA');
  var configJson = properties.getProperty('S02_CONFIG_SEED');

  if (!schemaJson) {
    throw new Error('S02_VALIDATE_REFUSED: S02_SCHEMA property not set.');
  }

  var schema = JSON.parse(schemaJson);
  var configSeed = configJson ? JSON.parse(configJson) : null;
  var adapter = new AppsScriptSheetAdapter();

  var result = S02Provisioner.validateSchema(schema, configSeed, adapter);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/* Apps Script Sheet adapter — implements the sheetAdapter interface using SpreadsheetApp.
 * Must be bound to the target spreadsheet. */

var AppsScriptSheetAdapter = function() {
  this.ss = SpreadsheetApp.getActiveSpreadsheet();

  this.getSheetId = function() {
    return this.ss.getId();
  };

  this.getTabNames = function() {
    return this.ss.getSheets().map(function(s) { return s.getName(); });
  };

  this.createTab = function(name) {
    var existing = this.ss.getSheetByName(name);
    if (existing) return; // Idempotent
    this.ss.insertSheet(name);
  };

  this.getHeaders = function(tabName) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) return [];
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return [];
    var range = sheet.getRange(1, 1, 1, lastCol);
    var values = range.getValues()[0];
    return values.map(function(v) { return String(v || '').trim(); });
  };

  this.setHeaders = function(tabName, headers) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);
    var range = sheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
  };

  this.freezeHeaderRow = function(tabName) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) return;
    sheet.setFrozenRows(1);
  };

  this.applyTextFormat = function(tabName, columnNames) {
    var sheet = this.ss.getSheetByName(tabName);
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
        // Apply Plain Text format to the entire column (rows 2 to max)
        var maxRows = Math.max(sheet.getMaxRows(), 2);
        var range = sheet.getRange(2, colIdx + 1, maxRows - 1, 1);
        range.setNumberFormat('@');
      }
    }
  };

  this.getData = function(tabName) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return [];
    var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    return range.getValues();
  };

  this.insertRow = function(tabName, values) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);
    var lastRow = sheet.getLastRow();
    var targetRow = lastRow + 1;
    var range = sheet.getRange(targetRow, 1, 1, values.length);
    range.setValues([values]);
  };

  this.deleteTab = function(tabName) {
    var sheet = this.ss.getSheetByName(tabName);
    if (!sheet) return;
    this.ss.deleteSheet(sheet);
  };

  this.checkTextFormat = function(tabName, columnNames) {
    var sheet = this.ss.getSheetByName(tabName);
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
        // Check format of row 2 in that column
        var lastRow = Math.max(sheet.getLastRow(), 2);
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
