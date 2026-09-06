/* Persistent adapter; all lookups enumerate sheets. Never provisions schema.
 * One S04 script project must be the only writer; its ScriptLock spans writes. */
function createSheetStore(ss, schema, flush) {
  const writable = ['Tasks', 'TaskEvents', 'AuditEvents', 'CommitJournal'];
  function table(name) {
    const definition = schema.tables.find(t => t.name === name);
    if (!definition) throw new Error('Unknown table');
    const matches = ss.getSheets().filter(s => s.getName() === name);
    if (matches.length !== 1) throw new Error('Missing/duplicate tab: ' + name);
    const sheet = matches[0];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const expected = definition.columns.map(c => c.name);
    if (headers.length !== expected.length || new Set(headers).size !== headers.length || expected.some(h => !headers.includes(h))) throw new Error('Schema mismatch: ' + name);
    return { sheet, headers, definition };
  }
  function read(name) {
    const t = table(name), ids = new Set();
    const rows = t.sheet.getLastRow() < 2 ? [] : t.sheet.getRange(2, 1, t.sheet.getLastRow() - 1, t.headers.length).getValues();
    return rows.map((values, index) => {
      const record = {};
      t.headers.forEach((h, i) => {
        const column = t.definition.columns.find(c => c.name === h);
        let v = values[i];
        if (v === '' || v === undefined || v === null) v = null;
        else if (column.type === 'BOOLEAN') {
          if (v === 'TRUE') v = true;
          else if (v === 'FALSE') v = false;
          if (typeof v !== 'boolean') throw new Error('Invalid boolean: ' + name + '.' + h);
        } else if (column.type === 'INTEGER') {
          if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error('Invalid integer: ' + name + '.' + h);
        } else if (Object.prototype.toString.call(v) === '[object Date]') {
          v = column.type === 'DATE' ? v.toISOString().slice(0, 10) : v.toISOString();
        } else if (column.type === 'TEXT') v = String(v);
        record[h] = v;
      });
      if (!record.id || ids.has(record.id)) throw new Error('Missing/duplicate id: ' + name);
      ids.add(record.id);
      return { record, row: index + 2 };
    });
  }
  function write(name, record, insert, id) {
    if (!writable.includes(name) || (!insert && ['TaskEvents', 'AuditEvents'].includes(name))) throw new Error('Write forbidden: ' + name);
    if (!record.id || (id && id !== record.id)) throw new Error('Immutable id');
    const t = table(name), rows = read(name), existing = rows.find(r => r.record.id === record.id);
    if (insert ? !!existing : !existing) throw new Error('Insert/update precondition: ' + name);
    if (Object.keys(record).some(k => !t.headers.includes(k))) throw new Error('Unknown write field');
    for (const c of t.definition.columns) {
      const v = record[c.name];
      if (c.required && (v === null || v === undefined || v === '')) throw new Error('Required field: ' + name + '.' + c.name);
      if (v !== null && v !== undefined) {
        if (c.type === 'BOOLEAN' && typeof v !== 'boolean') throw new Error('Boolean required');
        if (c.type === 'INTEGER' && !Number.isSafeInteger(v)) throw new Error('Integer required');
      }
    }
    const target = insert ? t.sheet.getLastRow() + 1 : existing.row;
    if (target > t.sheet.getMaxRows()) throw new Error('ROW_CAPACITY_REQUIRED: ' + name);
    const values = t.headers.map(h => {
      const v = record[h];
      if (v === null || v === undefined) return '';
      // Prevent notes and JSON text being interpreted as spreadsheet formulae.
      return typeof v === 'string' && /^[=']/.test(v) ? "'" + v : v;
    });
    t.sheet.getRange(target, 1, 1, values.length).setValues([values]);
    flush(); // Durable checkpoint before next write or releasing the lock.
  }
  return {
    getSheetId: () => ss.getId(),
    list: name => read(name).map(r => r.record),
    get: (name, id) => read(name).find(r => r.record.id === id)?.record || null,
    insert: (name, record) => write(name, record, true),
    update: (name, id, record) => write(name, record, false, id)
  };
}
module.exports = { createSheetStore };
