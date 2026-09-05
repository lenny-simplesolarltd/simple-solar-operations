/* Drift-prevention: verify embedded Apps Script schema/seed data
 * exactly matches the canonical JSON source files.
 * If this test fails, regenerate:
 *   apps-script/S02SchemaData.js from schema/tables.json
 *   apps-script/S02SeedData.js from schema/config-seed.json
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
