/* S02 DEV schema provisioner — core logic.
 * Pure functions: no SpreadsheetApp, no PropertiesService, no network.
 * Takes schema, config seed, and a sheetAdapter interface.
 * Returns result object suitable for evidence.
 *
 * Dual-environment: works as a global S02Provisioner in Apps Script
 * AND as a Node.js module for local tests.
 * No duplication — this is the single canonical implementation.
 */

var S02Provisioner = (function () {
  'use strict';

  var SCHEMA_VERSION = 'S02-1.0';

  function assertDevOnly(environment, sheetId, configuredSheetId) {
    if (environment !== 'DEV') {
      throw new Error('S02_PROVISIONER_REFUSED: environment must be DEV, got ' + environment);
    }
    if (!configuredSheetId) {
      throw new Error('S02_PROVISIONER_REFUSED: configuredSheetId is mandatory');
    }
    if (sheetId !== configuredSheetId) {
      throw new Error('S02_PROVISIONER_REFUSED: sheet identity mismatch. Expected ' + configuredSheetId + ', got ' + sheetId);
    }
  }

  function normalizeTabName(tableName) {
    return tableName;
  }

  function provisionSchema(schema, configSeed, sheetAdapter, options) {
    options = options || {};
    var dryRun = options.dryRun === true;
    var environment = options.environment || 'DEV';
    var configuredSheetId = options.configuredSheetId || null;

    var result = {
      schema_version: SCHEMA_VERSION,
      started_at: new Date().toISOString(),
      dry_run: dryRun,
      environment: environment,
      sheet_id: sheetAdapter.getSheetId ? sheetAdapter.getSheetId() : null,
      tables_total: schema.tables.length,
      tables_created: 0,
      tables_existing: 0,
      tabs_missing: [],
      tabs_unexpected: [],
      columns_added: [],
      columns_ok: 0,
      columns_missing: [],
      text_format_applied: [],
      seed_rows_inserted: 0,
      seed_rows_skipped: 0,
      seed_duplicates: [],
      primary_key_violations: [],
      placeholder_removed: false,
      errors: [],
      warnings: [],
      finished_at: null
    };

    try {
      assertDevOnly(environment, result.sheet_id, configuredSheetId);

      var seedOrder = schema.seed_order || schema.tables.map(function (t) { return t.name; });
      var existingTabs = sheetAdapter.getTabNames();
      var existingTabSet = {};
      for (var i = 0; i < existingTabs.length; i++) {
        existingTabSet[existingTabs[i].toLowerCase()] = true;
      }

      // Detect unexpected tabs (tabs not in schema)
      var schemaTabNames = {};
      for (var ti = 0; ti < schema.tables.length; ti++) {
        schemaTabNames[normalizeTabName(schema.tables[ti].name).toLowerCase()] = true;
      }
      for (var ei = 0; ei < existingTabs.length; ei++) {
        var et = existingTabs[ei];
        if (!schemaTabNames[et.toLowerCase()] && et.toLowerCase() !== 'sheet1') {
          result.tabs_unexpected.push(et);
        }
      }

      // Process tables in seed order
      for (var si = 0; si < seedOrder.length; si++) {
        var tableName = seedOrder[si];
        var table = null;
        for (var tj = 0; tj < schema.tables.length; tj++) {
          if (schema.tables[tj].name === tableName) { table = schema.tables[tj]; break; }
        }
        if (!table) {
          result.errors.push('Table in seed_order not found in schema: ' + tableName);
          continue;
        }

        var tabName = normalizeTabName(table.name);
        var tabExists = existingTabSet[tabName.toLowerCase()] === true;

        if (!tabExists) {
          if (!dryRun) {
            sheetAdapter.createTab(tabName);
            result.tables_created++;
          } else {
            result.tabs_missing.push(tabName);
          }
        } else {
          result.tables_existing++;
        }

        // Get or verify column headers
        var existingHeaders = tabExists ? sheetAdapter.getHeaders(tabName) : [];
        var expectedHeaders = [];
        for (var cj = 0; cj < table.columns.length; cj++) {
          expectedHeaders.push(table.columns[cj].name);
        }
        var existingHeaderSet = {};
        for (var hj = 0; hj < existingHeaders.length; hj++) {
          existingHeaderSet[existingHeaders[hj].toLowerCase().trim()] = true;
        }

        var missingHeaders = [];
        for (var mj = 0; mj < expectedHeaders.length; mj++) {
          if (!existingHeaderSet[expectedHeaders[mj].toLowerCase()]) {
            missingHeaders.push(expectedHeaders[mj]);
          }
        }

        if (missingHeaders.length > 0) {
          result.columns_missing.push({ tab: tabName, missing: missingHeaders });
          if (!dryRun) {
            var allHeaders = existingHeaders.concat(missingHeaders);
            sheetAdapter.setHeaders(tabName, allHeaders);
            result.columns_added.push({ tab: tabName, added: missingHeaders });
          }
        } else if (existingHeaders.length === expectedHeaders.length) {
          result.columns_ok++;
        } else if (existingHeaders.length > expectedHeaders.length) {
          var extra = [];
          for (var xj = 0; xj < existingHeaders.length; xj++) {
            var found = false;
            for (var yj = 0; yj < expectedHeaders.length; yj++) {
              if (expectedHeaders[yj].toLowerCase() === existingHeaders[xj].toLowerCase()) { found = true; break; }
            }
            if (!found) extra.push(existingHeaders[xj]);
          }
          if (extra.length > 0) {
            result.warnings.push('Extra columns in ' + tabName + ': ' + extra.join(', '));
          }
        }

        // Apply TEXT formatting
        var textCols = [];
        for (var tcj = 0; tcj < table.columns.length; tcj++) {
          if (table.columns[tcj].type === 'TEXT') textCols.push(table.columns[tcj]);
        }
        if (textCols.length > 0 && !dryRun) {
          var textColNames = [];
          for (var tnj = 0; tnj < textCols.length; tnj++) {
            textColNames.push(textCols[tnj].name);
          }
          sheetAdapter.applyTextFormat(tabName, textColNames);
          result.text_format_applied.push({ tab: tabName, columns: textColNames.length });
        }

        // Freeze header row
        if (!dryRun) {
          sheetAdapter.freezeHeaderRow(tabName);
        }

        // Check primary key column exists
        var keyCol = null;
        for (var kcj = 0; kcj < table.columns.length; kcj++) {
          if (table.columns[kcj].key) { keyCol = table.columns[kcj]; break; }
        }
        if (keyCol) {
          var hasKey = existingHeaderSet[keyCol.name.toLowerCase()] === true;
          if (!hasKey && missingHeaders.indexOf(keyCol.name) < 0) {
            result.primary_key_violations.push(tabName + ' missing primary key column: ' + keyCol.name);
          }
        }
      }

      // Seed configuration data
      if (configSeed) {
        seedConfigData(configSeed, schema, sheetAdapter, result, dryRun);
      }

      // Remove S01_Setup placeholder if safe
      var allSchemaTabsOk = result.tabs_missing.length === 0 && result.errors.length === 0;
      if (allSchemaTabsOk) {
        var placeholderTab = null;
        for (var pj = 0; pj < existingTabs.length; pj++) {
          if (existingTabs[pj].toLowerCase() === 'sheet1') { placeholderTab = existingTabs[pj]; break; }
        }
        if (placeholderTab && !dryRun) {
          var phHeaders = sheetAdapter.getHeaders(placeholderTab);
          var hasS01 = false;
          for (var phj = 0; phj < phHeaders.length; phj++) {
            if (phHeaders[phj].toLowerCase().indexOf('s01') >= 0) { hasS01 = true; break; }
          }
          if (phHeaders.length <= 1 && hasS01) {
            sheetAdapter.deleteTab(placeholderTab);
            result.placeholder_removed = true;
          }
        } else if (placeholderTab && dryRun) {
          result.placeholder_removed = 'would remove Sheet1 (S01_Setup placeholder)';
        }
      }

      result.finished_at = new Date().toISOString();
      result.success = result.errors.length === 0;
    } catch (err) {
      result.errors.push(err.message);
      result.finished_at = new Date().toISOString();
      result.success = false;
    }

    return result;
  }

  function seedConfigData(configSeed, schema, sheetAdapter, result, dryRun) {
    var tableMap = {};
    for (var i = 0; i < schema.tables.length; i++) {
      tableMap[schema.tables[i].name] = schema.tables[i];
    }

    var configKeys = Object.keys(configSeed);
    for (var k = 0; k < configKeys.length; k++) {
      var tableName = configKeys[k];
      var rows = configSeed[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      var table = tableMap[tableName];
      if (!table) {
        result.warnings.push('Config seed table not in schema: ' + tableName);
        continue;
      }

      var keyCol = null;
      for (var c = 0; c < table.columns.length; c++) {
        if (table.columns[c].key) { keyCol = table.columns[c]; break; }
      }
      if (!keyCol) {
        result.warnings.push('Cannot seed ' + tableName + ': no primary key column defined');
        continue;
      }

      var tabName = normalizeTabName(tableName);
      var existingKeys = dryRun ? {} : getExistingKeys(sheetAdapter, tabName, keyCol.name);
      var expectedCols = [];
      for (var e = 0; e < table.columns.length; e++) {
        expectedCols.push(table.columns[e].name);
      }

      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var keyValue = row[keyCol.name];
        if (!keyValue) {
          result.warnings.push('Seed row in ' + tableName + ' missing primary key value');
          continue;
        }

        if (existingKeys[String(keyValue).toLowerCase()]) {
          result.seed_rows_skipped++;
          continue;
        }

        if (!dryRun) {
          var rowValues = [];
          for (var v = 0; v < expectedCols.length; v++) {
            var colName = expectedCols[v];
            if (row[colName] !== undefined) {
              var val = row[colName];
              if (val === null) rowValues.push('');
              else if (typeof val === 'boolean') rowValues.push(val ? 'TRUE' : 'FALSE');
              else if (typeof val === 'object') rowValues.push(JSON.stringify(val));
              else rowValues.push(String(val));
            } else {
              rowValues.push('');
            }
          }

          var now = new Date().toISOString();
          var createdAtIndex = expectedCols.indexOf('created_at');
          var createdByIndex = expectedCols.indexOf('created_by');
          var updatedAtIndex = expectedCols.indexOf('updated_at');
          var updatedByIndex = expectedCols.indexOf('updated_by');
          var versionIndex = expectedCols.indexOf('version');
          var commitIdIndex = expectedCols.indexOf('commit_id');
          var sourceSystemIndex = expectedCols.indexOf('source_system');

          if (createdAtIndex >= 0 && rowValues[createdAtIndex] === '') rowValues[createdAtIndex] = now;
          if (createdByIndex >= 0 && rowValues[createdByIndex] === '') rowValues[createdByIndex] = 'S02-provisioner';
          if (updatedAtIndex >= 0 && rowValues[updatedAtIndex] === '') rowValues[updatedAtIndex] = now;
          if (updatedByIndex >= 0 && rowValues[updatedByIndex] === '') rowValues[updatedByIndex] = 'S02-provisioner';
          if (versionIndex >= 0 && rowValues[versionIndex] === '') rowValues[versionIndex] = '1';
          if (commitIdIndex >= 0 && rowValues[commitIdIndex] === '') rowValues[commitIdIndex] = 'S02-SEED-' + Date.now();
          if (sourceSystemIndex >= 0 && rowValues[sourceSystemIndex] === '') rowValues[sourceSystemIndex] = 'S02-provisioner';

          sheetAdapter.insertRow(tabName, rowValues);
        }

        result.seed_rows_inserted++;
        existingKeys[String(keyValue).toLowerCase()] = true;
      }
    }
  }

  function getExistingKeys(sheetAdapter, tabName, keyColName) {
    var headers = sheetAdapter.getHeaders(tabName);
    var keyIndex = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].toLowerCase() === keyColName.toLowerCase()) { keyIndex = i; break; }
    }
    if (keyIndex < 0) return {};

    var data = sheetAdapter.getData(tabName);
    var keys = {};
    for (var j = 0; j < data.length; j++) {
      if (data[j][keyIndex]) {
        keys[String(data[j][keyIndex]).toLowerCase()] = true;
      }
    }
    return keys;
  }

  function validateSchema(schema, configSeed, sheetAdapter) {
    var result = {
      schema_version: SCHEMA_VERSION,
      validated_at: new Date().toISOString(),
      sheet_id: sheetAdapter.getSheetId ? sheetAdapter.getSheetId() : null,
      expected_table_count: schema.tables.length,
      actual_table_count: 0,
      missing_tabs: [],
      unexpected_tabs: [],
      missing_columns: [],
      extra_columns: [],
      primary_key_columns_present: [],
      primary_key_columns_missing: [],
      text_format_missing: [],
      seed_row_counts: {},
      duplicate_primary_keys: [],
      schema_checksum: null,
      errors: [],
      warnings: [],
      success: false
    };

    function fail(section, err) {
      result.errors.push('[' + section + '] ' + (err.message || String(err)));
      result.success = false;
    }

    try {
      // Phase 1: Build schema tab name index
      var schemaTabNames = {};
      for (var i = 0; i < schema.tables.length; i++) {
        schemaTabNames[normalizeTabName(schema.tables[i].name).toLowerCase()] = true;
      }

      // Phase 2: Count existing tabs
      try {
        var existingTabs = sheetAdapter.getTabNames();
        result.actual_table_count = 0;
        for (var j = 0; j < existingTabs.length; j++) {
          var lower = existingTabs[j].toLowerCase();
          if (schemaTabNames[lower]) {
            result.actual_table_count++;
          } else if (lower !== 'sheet1') {
            result.unexpected_tabs.push(existingTabs[j]);
          }
        }
      } catch (e) { fail('phase2-tab-count', e); return result; }

      // Phase 3: Validate each table
      for (var k = 0; k < schema.tables.length; k++) {
        var table = schema.tables[k];
        var tableName = normalizeTabName(table.name);

        // Validate table.name is a proper string, not numeric
        if (typeof tableName !== 'string' || /^[0-9]+$/.test(tableName)) {
          fail('phase3-table-name', new Error('table.name is not a valid table name: ' + JSON.stringify(tableName) + ' at index ' + k));
          return result;
        }

        try {
          // Check tab exists
          var found = false;
          for (var m = 0; m < existingTabs.length; m++) {
            if (existingTabs[m].toLowerCase() === tableName.toLowerCase()) { found = true; break; }
          }
          if (!found) {
            result.missing_tabs.push(tableName);
            continue;
          }

          // Check columns
          try {
            var existingHeaders = sheetAdapter.getHeaders(tableName);
            var expectedHeaders = [];
            for (var n = 0; n < table.columns.length; n++) {
              expectedHeaders.push(table.columns[n].name);
            }
            var existingHeaderSet = {};
            for (var p = 0; p < existingHeaders.length; p++) {
              existingHeaderSet[existingHeaders[p].toLowerCase().trim()] = true;
            }

            var missing = [];
            for (var q = 0; q < expectedHeaders.length; q++) {
              if (!existingHeaderSet[expectedHeaders[q].toLowerCase()]) {
                missing.push(expectedHeaders[q]);
              }
            }
            if (missing.length > 0) {
              result.missing_columns.push({ tab: tableName, missing: missing });
            }

            var extra = [];
            for (var r = 0; r < existingHeaders.length; r++) {
              var foundExpected = false;
              for (var s = 0; s < expectedHeaders.length; s++) {
                if (expectedHeaders[s].toLowerCase() === existingHeaders[r].toLowerCase()) { foundExpected = true; break; }
              }
              if (!foundExpected) extra.push(existingHeaders[r]);
            }
            if (extra.length > 0) {
              result.extra_columns.push({ tab: tableName, extra: extra });
            }

            // Check primary key
            var keyCol = null;
            for (var t = 0; t < table.columns.length; t++) {
              if (table.columns[t].key) { keyCol = table.columns[t]; break; }
            }
            if (keyCol) {
              if (existingHeaderSet[keyCol.name.toLowerCase()]) {
                result.primary_key_columns_present.push(tableName);
              } else {
                result.primary_key_columns_missing.push(tableName);
              }
            }

            // Check TEXT format
            try {
              var textCols = [];
              for (var u = 0; u < table.columns.length; u++) {
                if (table.columns[u].type === 'TEXT') textCols.push(table.columns[u]);
              }
              if (textCols.length > 0) {
                var textColNames = [];
                for (var v = 0; v < textCols.length; v++) {
                  textColNames.push(textCols[v].name);
                }
                var formatInfo = sheetAdapter.checkTextFormat ? sheetAdapter.checkTextFormat(tableName, textColNames) : null;
                if (formatInfo && formatInfo.notFormatted && formatInfo.notFormatted.length > 0) {
                  result.text_format_missing.push({ tab: tableName, columns: formatInfo.notFormatted });
                }
              }
            } catch (e) { fail('phase3-text-format:' + tableName, e); }

            // Count seed rows
            try {
              if (configSeed && configSeed[table.name]) {
                var data = sheetAdapter.getData(tableName);
                result.seed_row_counts[table.name] = data.length;
              }
            } catch (e) { fail('phase3-seed-count:' + tableName, e); }

          } catch (e) { fail('phase3-columns:' + tableName, e); }

        } catch (e) { fail('phase3-table:' + tableName, e); }
      }

      result.success = result.missing_tabs.length === 0 &&
                       result.missing_columns.length === 0 &&
                       result.primary_key_columns_missing.length === 0 &&
                       result.errors.length === 0;
    } catch (err) {
      result.errors.push('[phase1-setup] ' + (err.message || String(err)));
      result.success = false;
    }

    return result;
  }

  return {
    provisionSchema: provisionSchema,
    validateSchema: validateSchema,
    assertDevOnly: assertDevOnly,
    normalizeTabName: normalizeTabName,
    seedConfigData: seedConfigData,
    getExistingKeys: getExistingKeys,
    SCHEMA_VERSION: SCHEMA_VERSION
  };
})();

// Node.js CommonJS support — sets module.exports when available.
// In Apps Script this line is harmless (typeof module === 'undefined').
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = S02Provisioner;
}
