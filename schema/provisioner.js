/* S02 DEV schema provisioner — core logic.
 * Pure functions: no SpreadsheetApp, no PropertiesService, no network.
 * Takes schema, config seed, and a sheetAdapter interface.
 * Returns result object suitable for evidence.
 */

const SCHEMA_VERSION = 'S02-1.0';

function assertDevOnly(environment, sheetId, configuredSheetId) {
  if (environment !== 'DEV') {
    throw new Error('S02_PROVISIONER_REFUSED: environment must be DEV, got ' + environment);
  }
  if (configuredSheetId && sheetId !== configuredSheetId) {
    throw new Error('S02_PROVISIONER_REFUSED: sheet identity mismatch. Expected ' + configuredSheetId + ', got ' + sheetId);
  }
}

function normalizeTabName(tableName) {
  return tableName;
}

function provisionSchema(schema, configSeed, sheetAdapter, options = {}) {
  const { dryRun = false, environment = 'DEV', configuredSheetId = null } = options;
  const result = {
    schema_version: SCHEMA_VERSION,
    started_at: new Date().toISOString(),
    dry_run: dryRun,
    environment,
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

    const seedOrder = schema.seed_order || schema.tables.map(t => t.name);
    const existingTabs = sheetAdapter.getTabNames();
    const existingTabSet = new Set(existingTabs.map(t => t.toLowerCase()));

    // Detect unexpected tabs (tabs not in schema)
    const schemaTabNames = new Set(schema.tables.map(t => normalizeTabName(t.name).toLowerCase()));
    for (const tab of existingTabs) {
      if (!schemaTabNames.has(tab.toLowerCase()) && tab.toLowerCase() !== 'sheet1') {
        result.tabs_unexpected.push(tab);
      }
    }

    // Process tables in seed order
    for (const tableName of seedOrder) {
      const table = schema.tables.find(t => t.name === tableName);
      if (!table) {
        result.errors.push('Table in seed_order not found in schema: ' + tableName);
        continue;
      }

      const tabName = normalizeTabName(table.name);
      const tabExists = existingTabSet.has(tabName.toLowerCase());

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
      const existingHeaders = tabExists ? sheetAdapter.getHeaders(tabName) : [];
      const expectedHeaders = table.columns.map(c => c.name);
      const existingHeaderSet = new Set(existingHeaders.map(h => h.toLowerCase().trim()));

      const missingHeaders = expectedHeaders.filter(h => !existingHeaderSet.has(h.toLowerCase()));
      if (missingHeaders.length > 0) {
        result.columns_missing.push({ tab: tabName, missing: missingHeaders });
        if (!dryRun) {
          // Add missing columns at the end, preserving existing column order
          const allHeaders = [...existingHeaders, ...missingHeaders];
          sheetAdapter.setHeaders(tabName, allHeaders);
          result.columns_added.push({ tab: tabName, added: missingHeaders });
        }
      } else if (existingHeaders.length === expectedHeaders.length) {
        result.columns_ok++;
      } else if (existingHeaders.length > expectedHeaders.length) {
        // Extra columns exist — warn but don't remove
        const extra = existingHeaders.filter(h => !expectedHeaders.some(e => e.toLowerCase() === h.toLowerCase()));
        result.warnings.push('Extra columns in ' + tabName + ': ' + extra.join(', '));
      }

      // Apply TEXT formatting
      const textCols = table.columns.filter(c => c.type === 'TEXT');
      if (textCols.length > 0 && !dryRun) {
        const textColNames = textCols.map(c => c.name);
        sheetAdapter.applyTextFormat(tabName, textColNames);
        result.text_format_applied.push({ tab: tabName, columns: textColNames.length });
      }

      // Freeze header row
      if (!dryRun) {
        sheetAdapter.freezeHeaderRow(tabName);
      }

      // Check primary key column exists
      const keyCol = table.columns.find(c => c.key);
      if (keyCol) {
        const hasKey = existingHeaders.some(h => h.toLowerCase() === keyCol.name.toLowerCase()) ||
                       missingHeaders.includes(keyCol.name);
        if (!hasKey) {
          result.primary_key_violations.push(tabName + ' missing primary key column: ' + keyCol.name);
        }
      }
    }

    // Seed configuration data
    if (configSeed) {
      seedConfigData(configSeed, schema, sheetAdapter, result, dryRun);
    }

    // Remove S01_Setup placeholder if safe
    const allSchemaTabsOk = result.tabs_missing.length === 0 && result.errors.length === 0;
    if (allSchemaTabsOk) {
      const placeholderTab = existingTabs.find(t => t.toLowerCase() === 'sheet1');
      if (placeholderTab && !dryRun) {
        // Verify Sheet1 has the S01_Setup column (safety check)
        const headers = sheetAdapter.getHeaders(placeholderTab);
        if (headers.length <= 1 && headers.some(h => h.toLowerCase().includes('s01'))) {
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
  const tableMap = new Map(schema.tables.map(t => [t.name, t]));

  for (const [tableName, rows] of Object.entries(configSeed)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const table = tableMap.get(tableName);
    if (!table) {
      result.warnings.push('Config seed table not in schema: ' + tableName);
      continue;
    }

    const keyCol = table.columns.find(c => c.key);
    if (!keyCol) {
      result.warnings.push('Cannot seed ' + tableName + ': no primary key column defined');
      continue;
    }

    const tabName = normalizeTabName(tableName);
    const existingKeys = dryRun ? new Set() : getExistingKeys(sheetAdapter, tabName, keyCol.name);
    const expectedCols = table.columns.map(c => c.name);

    for (const row of rows) {
      const keyValue = row[keyCol.name];
      if (!keyValue) {
        result.warnings.push('Seed row in ' + tableName + ' missing primary key value');
        continue;
      }

      if (existingKeys.has(String(keyValue).toLowerCase())) {
        result.seed_rows_skipped++;
        continue;
      }

      if (!dryRun) {
        const rowValues = expectedCols.map(colName => {
          if (row[colName] !== undefined) {
            const val = row[colName];
            if (val === null) return '';
            if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }
          return '';
        });

        // Set common audit columns for seed rows
        const now = new Date().toISOString();
        const createdAtIndex = expectedCols.indexOf('created_at');
        const createdByIndex = expectedCols.indexOf('created_by');
        const updatedAtIndex = expectedCols.indexOf('updated_at');
        const updatedByIndex = expectedCols.indexOf('updated_by');
        const versionIndex = expectedCols.indexOf('version');
        const commitIdIndex = expectedCols.indexOf('commit_id');
        const sourceSystemIndex = expectedCols.indexOf('source_system');

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
      existingKeys.add(String(keyValue).toLowerCase());
    }
  }
}

function getExistingKeys(sheetAdapter, tabName, keyColName) {
  const headers = sheetAdapter.getHeaders(tabName);
  const keyIndex = headers.findIndex(h => h.toLowerCase() === keyColName.toLowerCase());
  if (keyIndex < 0) return new Set();

  const data = sheetAdapter.getData(tabName);
  const keys = new Set();
  for (const row of data) {
    if (row[keyIndex]) {
      keys.add(String(row[keyIndex]).toLowerCase());
    }
  }
  return keys;
}

function validateSchema(schema, configSeed, sheetAdapter) {
  const result = {
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

  try {
    const existingTabs = sheetAdapter.getTabNames();
    const schemaTabNames = new Set(schema.tables.map(t => normalizeTabName(t.name).toLowerCase()));

    result.actual_table_count = 0;
    for (const tab of existingTabs) {
      const lower = tab.toLowerCase();
      if (schemaTabNames.has(lower)) {
        result.actual_table_count++;
      } else if (lower !== 'sheet1') {
        result.unexpected_tabs.push(tab);
      }
    }

    for (const table of schema.tables) {
      const tabName = normalizeTabName(table.name);
      if (!existingTabs.some(t => t.toLowerCase() === tabName.toLowerCase())) {
        result.missing_tabs.push(tabName);
        continue;
      }

      const existingHeaders = sheetAdapter.getHeaders(tabName);
      const expectedHeaders = table.columns.map(c => c.name);
      const existingHeaderSet = new Set(existingHeaders.map(h => h.toLowerCase().trim()));

      const missing = expectedHeaders.filter(h => !existingHeaderSet.has(h.toLowerCase()));
      if (missing.length > 0) {
        result.missing_columns.push({ tab: tabName, missing });
      }

      const extra = existingHeaders.filter(h => !expectedHeaders.some(e => e.toLowerCase() === h.toLowerCase()));
      if (extra.length > 0) {
        result.extra_columns.push({ tab: tabName, extra });
      }

      // Check primary key
      const keyCol = table.columns.find(c => c.key);
      if (keyCol) {
        if (existingHeaderSet.has(keyCol.name.toLowerCase())) {
          result.primary_key_columns_present.push(tabName);
        } else {
          result.primary_key_columns_missing.push(tabName);
        }
      }

      // Check TEXT format (can only verify in real environment)
      const textCols = table.columns.filter(c => c.type === 'TEXT');
      if (textCols.length > 0) {
        const formatInfo = sheetAdapter.checkTextFormat ? sheetAdapter.checkTextFormat(tabName, textCols.map(c => c.name)) : null;
        if (formatInfo && formatInfo.notFormatted && formatInfo.notFormatted.length > 0) {
          result.text_format_missing.push({ tab: tabName, columns: formatInfo.notFormatted });
        }
      }

      // Count seed rows
      if (configSeed && configSeed[table.name]) {
        const data = sheetAdapter.getData(tabName);
        result.seed_row_counts[table.name] = data.length;
      }
    }

    result.success = result.missing_tabs.length === 0 &&
                     result.missing_columns.length === 0 &&
                     result.primary_key_columns_missing.length === 0 &&
                     result.errors.length === 0;
  } catch (err) {
    result.errors.push(err.message);
    result.success = false;
  }

  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { provisionSchema, validateSchema, assertDevOnly, normalizeTabName, seedConfigData, getExistingKeys, SCHEMA_VERSION };
}
