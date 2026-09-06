/* Drift-prevention and Apps Script compatibility tests.
 * Verifies embedded schema/seed data matches canonical JSON,
 * and that the Apps Script provisioner core is compatible.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load canonical sources
const canonicalSchema = JSON.parse(fs.readFileSync('schema/tables.json', 'utf8'));
const canonicalSeed = JSON.parse(fs.readFileSync('schema/config-seed.json', 'utf8'));

// Execute the Apps Script data files in a sandbox to extract embedded data
function extractFromAppsScript(filePath, functionName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {};
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return sandbox[functionName]();
}

test('S02SchemaData.js embedded schema matches schema/tables.json exactly', () => {
  const embedded = extractFromAppsScript('apps-script/S02SchemaData.js', 'getS02SchemaDefinition');

  assert.equal(embedded.schema_version, canonicalSchema.schema_version, 'schema_version mismatch');
  assert.equal(embedded.tables.length, canonicalSchema.tables.length, 'table count mismatch');

  // Deep compare every table
  for (let i = 0; i < canonicalSchema.tables.length; i++) {
    const ct = canonicalSchema.tables[i];
    const et = embedded.tables[i];
    assert.equal(et.name, ct.name, 'table ' + i + ' name mismatch: ' + ct.name);
    assert.equal(et.columns.length, ct.columns.length, ct.name + ' column count mismatch');

    for (let j = 0; j < ct.columns.length; j++) {
      const cc = ct.columns[j];
      const ec = et.columns[j];
      assert.equal(ec.name, cc.name, ct.name + '.' + cc.name + ' name mismatch');
      assert.equal(ec.type, cc.type, ct.name + '.' + cc.name + ' type mismatch');
      assert.equal(ec.required || false, cc.required || false, ct.name + '.' + cc.name + ' required mismatch');
      assert.equal(ec.key || false, cc.key || false, ct.name + '.' + cc.name + ' key mismatch');
      assert.equal(ec.unique || false, cc.unique || false, ct.name + '.' + cc.name + ' unique mismatch');
      assert.equal(ec.nullable || false, cc.nullable || false, ct.name + '.' + cc.name + ' nullable mismatch');
    }
  }

  // Verify foreign keys
  assert.equal(embedded.foreign_keys.length, canonicalSchema.foreign_keys.length, 'FK count mismatch');
  for (let i = 0; i < canonicalSchema.foreign_keys.length; i++) {
    const cfk = canonicalSchema.foreign_keys[i];
    const efk = embedded.foreign_keys[i];
    assert.equal(efk.from_table, cfk.from_table, 'FK ' + i + ' from_table mismatch');
    assert.equal(efk.from_column, cfk.from_column, 'FK ' + i + ' from_column mismatch');
    assert.equal(efk.to_table, cfk.to_table, 'FK ' + i + ' to_table mismatch');
    assert.equal(efk.to_column, cfk.to_column, 'FK ' + i + ' to_column mismatch');
  }

  // Verify seed_order — compare as JSON strings to avoid deepStrictEqual ordering issues
  assert.equal(JSON.stringify(embedded.seed_order), JSON.stringify(canonicalSchema.seed_order), 'seed_order mismatch');

  // Verify text_columns_must_be_plain_text
  assert.equal(JSON.stringify(embedded.text_columns_must_be_plain_text), JSON.stringify(canonicalSchema.text_columns_must_be_plain_text), 'TEXT columns list mismatch');
});

test('S02SeedData.js embedded seed matches schema/config-seed.json exactly', () => {
  const embedded = extractFromAppsScript('apps-script/S02SeedData.js', 'getS02ConfigSeed');

  assert.equal(embedded.config_version, canonicalSeed.config_version, 'config_version mismatch');

  // Verify each seeded table
  for (const tableName of Object.keys(canonicalSeed)) {
    if (tableName === 'config_version' || tableName === 'generated' || tableName === 'notes') continue;
    assert.ok(embedded[tableName], 'missing seed table: ' + tableName);
    assert.equal(embedded[tableName].length, canonicalSeed[tableName].length, tableName + ' row count mismatch');

    for (let i = 0; i < canonicalSeed[tableName].length; i++) {
      const cr = canonicalSeed[tableName][i];
      const er = embedded[tableName][i];

      // Compare by id or primary key
      const idKey = Object.keys(cr).find(k => k === 'id' || k === 'function_id' || k === 'sku' || k === 'template_code' || k === 'key');
      if (idKey) {
        assert.equal(er[idKey], cr[idKey], tableName + ' row ' + i + ' ' + idKey + ' mismatch');
      }

      // Spot-check key fields
      for (const key of Object.keys(cr)) {
        if (key === 'generated' || key === 'notes') continue;
        assert.equal(JSON.stringify(er[key]), JSON.stringify(cr[key]),
          tableName + ' row ' + i + ' field ' + key + ' mismatch');
      }
    }
  }
});

test('S02_SCHEMA_VERSION constant matches schema version', () => {
  const source = fs.readFileSync('apps-script/S02SchemaData.js', 'utf8');
  const match = source.match(/var S02_SCHEMA_VERSION = "([^"]+)"/);
  assert.ok(match, 'S02_SCHEMA_VERSION not found in S02SchemaData.js');
  assert.equal(match[1], canonicalSchema.schema_version, 'S02_SCHEMA_VERSION constant mismatch');
});

test('embedded schema is valid JSON (round-trip)', () => {
  const embedded = extractFromAppsScript('apps-script/S02SchemaData.js', 'getS02SchemaDefinition');
  // Verify it can be serialized and deserialized without loss
  const roundTripped = JSON.parse(JSON.stringify(embedded));
  assert.equal(roundTripped.tables.length, canonicalSchema.tables.length);
});

test('no S02_SCHEMA or S02_CONFIG_SEED reference in provisioner', () => {
  const source = fs.readFileSync('apps-script/S02Provisioner.js', 'utf8');
  assert.ok(!source.includes('S02_SCHEMA'), 'S02Provisioner.js should not reference S02_SCHEMA property');
  assert.ok(!source.includes('S02_CONFIG_SEED'), 'S02Provisioner.js should not reference S02_CONFIG_SEED property');
  assert.ok(source.includes('getS02SchemaDefinition'), 'S02Provisioner.js should call getS02SchemaDefinition()');
  assert.ok(source.includes('getS02ConfigSeed'), 'S02Provisioner.js should call getS02ConfigSeed()');
});

// --- Apps Script compatibility tests ---

test('S02ProvisionerCore.js exposes S02Provisioner global with provisionSchema and validateSchema', () => {
  const source = fs.readFileSync('apps-script/S02ProvisionerCore.js', 'utf8');
  const sandbox = {};
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);

  assert.ok(sandbox.S02Provisioner, 'S02Provisioner global not defined');
  assert.equal(typeof sandbox.S02Provisioner.provisionSchema, 'function', 'provisionSchema missing');
  assert.equal(typeof sandbox.S02Provisioner.validateSchema, 'function', 'validateSchema missing');
  assert.equal(typeof sandbox.S02Provisioner.assertDevOnly, 'function', 'assertDevOnly missing');
  assert.equal(sandbox.S02Provisioner.SCHEMA_VERSION, 'S02-1.0', 'SCHEMA_VERSION mismatch');
});

test('S02ProvisionerCore.js has no Node.js runtime dependencies', () => {
  const source = fs.readFileSync('apps-script/S02ProvisionerCore.js', 'utf8');

  const banned = [
    { pattern: 'require(', desc: 'require() call' },
    { pattern: 'module.exports', desc: 'module.exports' },
    { pattern: 'exports.', desc: 'exports. assignment' },
    { pattern: 'require("fs")', desc: 'fs module' },
    { pattern: "require('fs')", desc: 'fs module' },
    { pattern: 'process.', desc: 'process global' },
    { pattern: '__dirname', desc: '__dirname' },
    { pattern: '__filename', desc: '__filename' }
  ];

  // The file IS allowed to have 'module.exports' ONLY on the last line(s)
  // (for Node compatibility). Check that it only appears in the final if-guard.
  const lines = source.trimEnd().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('module.exports') || line.includes('exports.')) {
      // Allow only in the last conditional block
      assert.ok(i >= lines.length - 5, 'module.exports/exports found outside final guard at line ' + (i + 1));
    }
  }

  // Check no require() calls exist
  assert.ok(!source.includes('require('), 'S02ProvisionerCore.js must not contain require()');
  assert.ok(!source.includes('process.'), 'S02ProvisionerCore.js must not reference process');
});

test('S02ProvisionerCore.js matches schema/provisioner.js exactly', () => {
  const canonical = fs.readFileSync('schema/provisioner.js', 'utf8');
  const appsScript = fs.readFileSync('apps-script/S02ProvisionerCore.js', 'utf8');
  assert.equal(appsScript, canonical, 'S02ProvisionerCore.js must be identical to schema/provisioner.js');
});

test('S02ProvisionerCore.js uses only ES3-compatible syntax (no const/let/arrow/for-of)', () => {
  const source = fs.readFileSync('apps-script/S02ProvisionerCore.js', 'utf8');

  // const/let outside of string literals
  const codeOnly = source.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '').replace(/\/\/.*/g, '');

  // 'const ' not preceded by a letter (catches standalone const, not 'reconcile')
  assert.ok(!/\bconst\s+\w/.test(codeOnly), 'S02ProvisionerCore.js must not use const declarations');

  // 'let ' not preceded by a letter
  assert.ok(!/\blet\s+\w/.test(codeOnly), 'S02ProvisionerCore.js must not use let declarations');

  // No arrow functions (=> outside strings)
  assert.ok(!codeOnly.includes('=>'), 'S02ProvisionerCore.js must not use arrow functions');

  // No for...of
  assert.ok(!/\bfor\s*\(.*\bof\b/.test(codeOnly), 'S02ProvisionerCore.js must not use for...of');

  // No template literals
  assert.ok(!codeOnly.includes('`'), 'S02ProvisionerCore.js must not use template literals');
});

test('canonical schema/provisioner.js also exposes S02Provisioner global', () => {
  const source = fs.readFileSync('schema/provisioner.js', 'utf8');
  const sandbox = {};
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);

  assert.ok(sandbox.S02Provisioner, 'canonical provisioner.js must define S02Provisioner global');
  assert.equal(typeof sandbox.S02Provisioner.provisionSchema, 'function');
});

test('provisioner core functions identically via global and require', () => {
  // Test that both access paths work and produce identical results
  const viaRequire = require('../schema/provisioner.js');

  const source = fs.readFileSync('apps-script/S02ProvisionerCore.js', 'utf8');
  const sandbox = {};
  vm.runInContext(source, vm.createContext(sandbox));
  const viaGlobal = sandbox.S02Provisioner;

  // Both should have the same function signatures
  assert.equal(typeof viaRequire.provisionSchema, 'function');
  assert.equal(typeof viaGlobal.provisionSchema, 'function');
  assert.equal(typeof viaRequire.validateSchema, 'function');
  assert.equal(typeof viaGlobal.validateSchema, 'function');

  // Both should produce identical results for a basic call
  const schema = require('../schema/tables.json');
  const adapter = {
    getSheetId: () => 'test-sheet',
    getTabNames: () => [],
    createTab: () => {},
    getHeaders: () => [],
    setHeaders: () => {},
    freezeHeaderRow: () => {},
    applyTextFormat: () => {},
    getData: () => [],
    insertRow: () => {},
    deleteTab: () => {},
    checkTextFormat: () => ({ notFormatted: [] })
  };

  const opts = { dryRun: true, environment: 'DEV', configuredSheetId: 'test-sheet' };
  const viaRequireResult = viaRequire.provisionSchema(schema, null, adapter, opts);
  const viaGlobalResult = viaGlobal.provisionSchema(schema, null, adapter, opts);

  assert.equal(viaRequireResult.tables_total, viaGlobalResult.tables_total);
  assert.equal(viaRequireResult.success, viaGlobalResult.success);
});

// --- Adapter safety: no getSheetByName in operational paths ---

test('S02Provisioner.js adapter uses _findSheetByName, not getSheetByName', () => {
  const source = fs.readFileSync('apps-script/S02Provisioner.js', 'utf8');

  // The adapter starts at 'var AppsScriptSheetAdapter' and ends at the last '};'
  const adapterStart = source.indexOf('var AppsScriptSheetAdapter');
  assert.ok(adapterStart > 0, 'AppsScriptSheetAdapter section not found');

  // Find the adapter's closing: the adapter is an IIFE assigned to a var,
  // so find the matching '};' after the adapter start
  const adapterCode = source.substring(adapterStart);

  // The adapter must NOT call getSheetByName
  assert.ok(!adapterCode.includes('.getSheetByName('),
    'AppsScriptSheetAdapter must not call .getSheetByName() — use _findSheetByName');

  // The adapter must use _findSheetByName
  assert.ok(adapterCode.includes('_findSheetByName'),
    'AppsScriptSheetAdapter must use _findSheetByName for sheet lookups');
});

test('S02Provisioner.js: only runS02HeaderDiagnostic contains getSheetByName', () => {
  const source = fs.readFileSync('apps-script/S02Provisioner.js', 'utf8');

  // Find the diagnostic function boundaries
  const diagStart = source.indexOf('function runS02HeaderDiagnostic');
  const diagEnd = source.indexOf('/* --- Enumerated sheet lookup');
  assert.ok(diagStart > 0 && diagEnd > diagStart, 'diagnostic boundaries not found');

  const beforeDiag = source.substring(0, diagStart);
  const diagSection = source.substring(diagStart, diagEnd);
  const afterDiag = source.substring(diagEnd);

  // Before diagnostic: zero getSheetByName calls
  const beforeCalls = (beforeDiag.match(/\.getSheetByName\(/g) || []).length;
  assert.equal(beforeCalls, 0,
    'No .getSheetByName() calls before diagnostic, found ' + beforeCalls);

  // Diagnostic section: should contain getSheetByName calls (Path B test)
  const diagCalls = (diagSection.match(/\.getSheetByName\(/g) || []).length;
  assert.ok(diagCalls > 0,
    'Diagnostic should contain .getSheetByName() for Path B test');

  // After diagnostic (adapter + helper): zero getSheetByName calls
  // (comments referencing getSheetByName are allowed)
  const afterCalls = (afterDiag.match(/\.getSheetByName\(/g) || []).length;
  assert.equal(afterCalls, 0,
    'No .getSheetByName() calls in adapter or helpers, found ' + afterCalls);
});
