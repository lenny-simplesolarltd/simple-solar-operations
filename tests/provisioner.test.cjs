const { test } = require('node:test');
const assert = require('node:assert/strict');
const { provisionSchema, validateSchema, assertDevOnly } = require('../schema/provisioner.js');
const tables = require('../schema/tables.json');
const configSeed = require('../schema/config-seed.json');

// In-memory mock sheet adapter for local testing
function createMockSheetAdapter(initialTabs = []) {
  const tabs = new Map();

  // Initialize tabs with optional pre-existing headers
  for (const { name, headers, data } of initialTabs) {
    tabs.set(name.toLowerCase(), {
      name,
      headers: headers || [],
      data: data || [],
      textFormats: new Set(),
      frozen: false
    });
  }

  return {
    getSheetId: () => 'mock-dev-sheet-id',

    getTabNames: () => Array.from(tabs.values()).map(t => t.name),

    createTab(name) {
      if (!tabs.has(name.toLowerCase())) {
        tabs.set(name.toLowerCase(), { name, headers: [], data: [], textFormats: new Set(), frozen: false });
      }
    },

    getHeaders(tabName) {
      const tab = tabs.get(tabName.toLowerCase());
      return tab ? [...tab.headers] : [];
    },

    setHeaders(tabName, headers) {
      const tab = tabs.get(tabName.toLowerCase());
      if (!tab) throw new Error('Tab not found: ' + tabName);
      tab.headers = headers;
    },

    freezeHeaderRow(tabName) {
      const tab = tabs.get(tabName.toLowerCase());
      if (tab) tab.frozen = true;
    },

    applyTextFormat(tabName, columnNames) {
      const tab = tabs.get(tabName.toLowerCase());
      if (tab) {
        for (const col of columnNames) {
          tab.textFormats.add(col.toLowerCase());
        }
      }
    },

    getData(tabName) {
      const tab = tabs.get(tabName.toLowerCase());
      return tab ? tab.data.map(r => [...r]) : [];
    },

    insertRow(tabName, values) {
      const tab = tabs.get(tabName.toLowerCase());
      if (!tab) throw new Error('Tab not found: ' + tabName);
      tab.data.push([...values]);
    },

    deleteTab(tabName) {
      tabs.delete(tabName.toLowerCase());
    },

    checkTextFormat(tabName, columnNames) {
      const tab = tabs.get(tabName.toLowerCase());
      if (!tab) return { notFormatted: columnNames };
      const notFormatted = columnNames.filter(c => !tab.textFormats.has(c.toLowerCase()));
      return { notFormatted };
    },

    // Debug helper
    _dump() {
      const out = {};
      for (const [k, v] of tabs) {
        out[v.name] = { headers: v.headers, dataCount: v.data.length, frozen: v.frozen, textFormats: [...v.textFormats] };
      }
      return out;
    }
  };
}

// --- Dry run tests ---

test('dry run reports all actions without modifying sheet', () => {
  const adapter = createMockSheetAdapter();
  const result = provisionSchema(tables, configSeed, adapter, {
    dryRun: true,
    environment: 'DEV',
    configuredSheetId: 'mock-dev-sheet-id'
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.tables_total, tables.tables.length);
  assert.equal(result.tables_created, 0, 'dry run should not create');
  assert.ok(result.tabs_missing.length > 0, 'should report missing tabs');
  assert.equal(adapter.getTabNames().length, 0, 'sheet should be empty after dry run');
  assert.equal(result.success, true);
});

test('dry run reports which columns would be added', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['id', 'email'], data: [] }
  ]);
  const result = provisionSchema(tables, configSeed, adapter, {
    dryRun: true,
    environment: 'DEV',
    configuredSheetId: 'mock-dev-sheet-id'
  });

  const peopleCols = result.columns_missing.find(c => c.tab === 'People');
  assert.ok(peopleCols, 'People should have missing columns reported');
  assert.ok(peopleCols.missing.includes('display_name'), 'missing display_name');
  assert.ok(peopleCols.missing.includes('role'), 'missing role');
  assert.equal(result.tables_created, 0, 'dry run should not create');
});

// --- Environment safety ---

test('refuses non-DEV environment', () => {
  const adapter = createMockSheetAdapter();
  const r1 = provisionSchema(tables, configSeed, adapter, { environment: 'PROD', configuredSheetId: 'x' });
  assert.equal(r1.success, false);
  assert.ok(r1.errors.some(e => e.includes('environment must be DEV')), 'should reject PROD');

  const r2 = provisionSchema(tables, configSeed, adapter, { environment: 'TEST', configuredSheetId: 'x' });
  assert.equal(r2.success, false);
  assert.ok(r2.errors.some(e => e.includes('environment must be DEV')), 'should reject TEST');
});

test('refuses sheet identity mismatch', () => {
  const adapter = createMockSheetAdapter();
  const result = provisionSchema(tables, configSeed, adapter, { environment: 'DEV', configuredSheetId: 'different-sheet' });
  assert.equal(result.success, false);
  assert.ok(result.errors.some(e => e.includes('sheet identity mismatch')), 'should reject mismatch');
});

test('accepts null configuredSheetId (no mismatch check)', () => {
  const adapter = createMockSheetAdapter();
  const result = provisionSchema(tables, configSeed, adapter, {
    dryRun: true,
    environment: 'DEV',
    configuredSheetId: null
  });
  assert.equal(result.success, true);
});

// --- Idempotency ---

test('idempotent: running twice does not duplicate tabs', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const r1 = provisionSchema(tables, configSeed, adapter, opts);
  assert.ok(r1.tables_created > 0, 'first run should create tables');

  const r2 = provisionSchema(tables, configSeed, adapter, opts);
  assert.equal(r2.tables_created, 0, 'second run should not create tables');
  assert.equal(r2.tables_existing, r1.tables_created + r1.tables_existing);
});

test('idempotent: does not duplicate columns', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['id', 'email', 'display_name'], data: [] }
  ]);
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const result = provisionSchema(tables, configSeed, adapter, opts);
  const peopleCols = result.columns_added.find(c => c.tab === 'People');
  assert.ok(peopleCols, 'should add remaining columns');
  assert.ok(!peopleCols.added.includes('id'), 'should not re-add id');
  assert.ok(!peopleCols.added.includes('email'), 'should not re-add email');

  // Second run
  const r2 = provisionSchema(tables, configSeed, adapter, opts);
  const peopleAdded2 = r2.columns_added.find(c => c.tab === 'People');
  assert.equal(peopleAdded2, undefined, 'second run should add no People columns');
});

test('idempotent: does not duplicate seed rows', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const r1 = provisionSchema(tables, configSeed, adapter, opts);
  const firstRunCompanies = r1.seed_rows_inserted;

  const r2 = provisionSchema(tables, configSeed, adapter, opts);
  assert.equal(r2.seed_rows_inserted, 0, 'second run should insert 0 seed rows');
  assert.equal(r2.seed_rows_skipped, firstRunCompanies, 'all seed rows should be skipped');
});

// --- Seed data ---

test('seeds Companies, Contacts, People, Products, etc.', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  provisionSchema(tables, configSeed, adapter, opts);

  const companies = adapter.getData('Companies');
  assert.ok(companies.length >= 2, 'Companies should have at least 2 rows');

  const people = adapter.getData('People');
  assert.ok(people.length >= 7, 'People should have at least 7 rows');

  const products = adapter.getData('Products');
  assert.ok(products.length >= 2, 'Products should have at least 2 rows');

  const releaseModes = adapter.getData('ReleaseModes');
  assert.equal(releaseModes.length, 20, 'ReleaseModes should have 20 rows');
});

test('seed rows have NOT_CONFIGURED for unknown values', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  provisionSchema(tables, configSeed, adapter, opts);

  const contacts = adapter.getData('Contacts');
  const tom = contacts.find(r => r.some(v => String(v).includes('Tom')));
  assert.ok(tom, 'Tom should be seeded');
  // Check the email column
  const contactsTable = tables.tables.find(t => t.name === 'Contacts');
  const emailIdx = contactsTable.columns.findIndex(c => c.name === 'email');
  assert.ok(tom[emailIdx] === 'NOT_CONFIGURED' || String(tom[emailIdx]).includes('NOT_CONFIGURED'),
    'Tom email should be NOT_CONFIGURED');
});

// --- TEXT formatting ---

test('applies text format to TEXT columns', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  provisionSchema(tables, configSeed, adapter, opts);

  // Check that Customers.postcode has text format applied
  const customersTab = adapter._dump()['Customers'];
  assert.ok(customersTab, 'Customers tab should exist');
  // Verify text format was applied by checking the adapter's internal state
  const formatCheck = adapter.checkTextFormat('Customers', ['postcode', 'phone']);
  assert.equal(formatCheck.notFormatted.length, 0, 'postcode and phone should have text format');
});

// --- S01 placeholder removal ---

test('removes S01_Setup placeholder after successful provisioning', () => {
  const adapter = createMockSheetAdapter([
    { name: 'Sheet1', headers: ['S01_Setup'], data: [] }
  ]);
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const result = provisionSchema(tables, configSeed, adapter, opts);
  assert.equal(result.placeholder_removed, true, 'S01_Setup should be removed');
  assert.ok(!adapter.getTabNames().includes('Sheet1'), 'Sheet1 should be gone');
});

test('does not remove non-placeholder Sheet1', () => {
  const adapter = createMockSheetAdapter([
    { name: 'Sheet1', headers: ['SomeBusinessData', 'AnotherColumn'], data: [] }
  ]);
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const result = provisionSchema(tables, configSeed, adapter, opts);
  assert.equal(result.placeholder_removed, false, 'should not remove non-placeholder Sheet1');
  assert.ok(adapter.getTabNames().includes('Sheet1'), 'Sheet1 should remain');
});

// --- Validation ---

test('validateSchema reports correct counts', () => {
  const adapter = createMockSheetAdapter();
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };
  provisionSchema(tables, configSeed, adapter, opts);

  const validation = validateSchema(tables, configSeed, adapter);
  assert.equal(validation.expected_table_count, tables.tables.length);
  assert.ok(validation.actual_table_count >= tables.tables.length, 'all tables should exist');
  assert.equal(validation.missing_tabs.length, 0, 'no missing tabs');
  assert.equal(validation.missing_columns.length, 0, 'no missing columns');
  assert.equal(validation.success, true);
});

test('validateSchema detects missing tabs', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['id', 'email', 'display_name'], data: [] }
  ]);
  const validation = validateSchema(tables, configSeed, adapter);
  assert.ok(validation.missing_tabs.length > 0, 'should detect missing tabs');
  assert.equal(validation.success, false);
});

test('validateSchema detects missing columns', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['id'], data: [] }
  ]);
  const validation = validateSchema(tables, configSeed, adapter);
  const peopleMissing = validation.missing_columns.find(c => c.tab === 'People');
  assert.ok(peopleMissing, 'should detect missing People columns');
  assert.ok(peopleMissing.missing.includes('email'), 'email should be missing');
});

test('validateSchema detects missing primary keys', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['email', 'display_name'], data: [] }
  ]);
  const validation = validateSchema(tables, configSeed, adapter);
  assert.ok(validation.primary_key_columns_missing.includes('People'), 'People missing primary key');
});

// --- Schema integrity ---

test('all tables in seed_order exist in schema', () => {
  const tableNames = new Set(tables.tables.map(t => t.name));
  for (const name of tables.seed_order) {
    assert.ok(tableNames.has(name), 'seed_order table not in schema: ' + name);
  }
});

test('provisioner preserves existing data when adding columns', () => {
  const adapter = createMockSheetAdapter([
    { name: 'People', headers: ['id', 'email'], data: [['PERSON-test', 'test@test.com']] }
  ]);
  const opts = { dryRun: false, environment: 'DEV', configuredSheetId: 'mock-dev-sheet-id' };

  const result = provisionSchema(tables, configSeed, adapter, opts);

  const data = adapter.getData('People');
  const existingRow = data.find(r => String(r[0]) === 'PERSON-test');
  assert.ok(existingRow, 'existing data should survive');
  assert.equal(String(existingRow[1]), 'test@test.com', 'existing email should survive');
});

test('assertDevOnly rejects PROD, TEST, missing, null', () => {
  assert.throws(() => assertDevOnly('PROD'), /environment must be DEV/);
  assert.throws(() => assertDevOnly('TEST'), /environment must be DEV/);
  assert.throws(() => assertDevOnly('dev'), /environment must be DEV/);
  assert.throws(() => assertDevOnly(null), /environment must be DEV/);
  assert.throws(() => assertDevOnly(undefined), /environment must be DEV/);
  // DEV passes
  assert.doesNotThrow(() => assertDevOnly('DEV'));
});
