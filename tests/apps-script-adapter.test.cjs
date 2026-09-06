const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const schema = require('../schema/tables.json');
const seed = require('../schema/config-seed.json');

function fixture(failure) {
  const calls = { named: 0, active: 0, writes: 0 };
  const fail = method => { if (failure === method) throw new Error('Sheet 0 not found'); };
  const write = () => { calls.writes++; throw new Error('write forbidden'); };
  const sheets = schema.tables.map((table, index) => {
    const headers = table.columns.map(c => c.name);
    const rows = [headers, ...(seed[table.name] || []).map(row => headers.map(h => row[h] ?? ''))];
    return {
      getName() { fail('getName'); return table.name; },
      getSheetId() { fail('getSheetId'); return index + 1; },
      getLastColumn() { fail('getLastColumn'); return headers.length; },
      getLastRow() { return rows.length; },
      getRange(row, col, count = 1, width = 1) {
        fail('getRange');
        return {
          getValues() { fail('getValues'); return rows.slice(row - 1, row - 1 + count).map(r => r.slice(col - 1, col - 1 + width)); },
          getNumberFormat() { return '@'; },
          setValues: write, setNumberFormat: write
        };
      },
      setFrozenRows: write
    };
  });
  const ss = {
    getId: () => 'mock-dev', getName: () => 'DEV fixture',
    getSheets() { fail('getSheets'); return sheets; },
    getSheetByName() { calls.named++; throw new Error('Sheet 0 not found'); },
    getActiveSheet() { calls.active++; throw new Error('active sheet forbidden'); },
    insertSheet: write, deleteSheet: write
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActiveSheet: ss.getActiveSheet },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV', sheetId: 'mock-dev' }) }) },
    console: { log() {} }
  });
  for (const file of ['S02ProvisionerCore', 'S02SchemaData', 'S02SeedData', 'S02Provisioner']) {
    vm.runInContext(fs.readFileSync('apps-script/' + file + '.js', 'utf8'), context);
  }
  return { context, ss, calls, adapter: new context.AppsScriptSheetAdapter() };
}

for (const name of ['Companies', 'People', 'Jobs']) {
  test(name + ' headers resolve through enumeration', () => {
    const { adapter, calls } = fixture();
    assert.deepEqual(Array.from(adapter.getHeaders(name)), schema.tables.find(t => t.name === name).columns.map(c => c.name));
    assert.equal(calls.named, 0);
  });
}

test('Apps Script validation reads all 60 tables without named lookup, active sheet or writes', () => {
  const { context, calls } = fixture();
  const result = context.runS02Validate();
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.actual_table_count, 60);
  assert.equal(result.primary_key_columns_present.length, 60);
  assert.equal(result.seed_row_counts.Companies, seed.Companies.length);
  assert.equal(result.seed_row_counts.People, seed.People.length);
  assert.deepEqual(calls, { named: 0, active: 0, writes: 0 });
});

test('missing tab returns null/empty data and explicit header error', () => {
  const { context, ss, adapter, calls } = fixture();
  assert.equal(context._findSheetByName(ss, 'Missing'), null);
  assert.equal(adapter.getData('Missing').length, 0);
  assert.throws(() => adapter.getHeaders('Missing'), /sheet not found via enumeration/);
  assert.deepEqual(Array.from(adapter.checkTextFormat('Missing', ['id']).notFormatted), ['id']);
  assert.deepEqual(calls, { named: 0, active: 0, writes: 0 });
});

test('diagnostic retains successful header reads despite named lookup failures and stays read-only', () => {
  const { context, calls } = fixture();
  const result = context.runS02HeaderDiagnostic();
  assert.equal(result.tests.length, 3);
  for (const row of result.tests) {
    assert.equal(row.get_sheets_ok, true);
    assert.equal(row.enumerated_sheet_count, 60);
    assert.equal(row.enumerated_lookup_found, true);
    assert.equal(row.enumerated_sheet_name, row.tab);
    assert.ok(row.enumerated_sheet_id > 0);
    assert.equal(row.range_ok, true);
    assert.equal(row.values_rows, 1);
    assert.equal(row.values_cols, row.last_column);
    assert.equal(row.first_header, 'id');
    assert.equal(row.header_read_ok, true);
    assert.equal(row.success, true);
    assert.equal(row.getSheetByName_error, 'Sheet 0 not found');
  }
  assert.deepEqual(calls, { named: 3, active: 0, writes: 0 });
});

for (const [method, field] of Object.entries({
  getSheets: 'get_sheets_error', getName: 'enumerated_error',
  getSheetId: 'enumerated_sheetId_error', getLastColumn: 'last_column_error',
  getRange: 'getRange_error', getValues: 'getValues_error'
})) {
  test('diagnostic identifies failure at ' + method, () => {
    const { context, calls } = fixture(method);
    const result = context.runS02HeaderDiagnostic();
    const rows = method === 'getSheets' ? [result] : result.tests;
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.match(row[field], /Sheet 0 not found/);
      if (method === 'getName') assert.match(row[field], /sheets\[0\]\.getName failed/);
      if (method !== 'getSheets') {
        assert.equal(row.getSheetByName_error, 'Sheet 0 not found');
        assert.equal(row.success, method === 'getSheetId');
      }
    }
    assert.equal(calls.writes, 0);
    assert.equal(calls.active, 0);
  });
}
