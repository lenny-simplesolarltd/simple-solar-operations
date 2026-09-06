/* Local-only durable test adapter. Never included in Apps Script package. */
const fs = require('node:fs');
function createFileStore(file, sheetId) {
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const save = data => { fs.writeFileSync(file + '.next', JSON.stringify(data)); fs.renameSync(file + '.next', file); };
  return {
    getSheetId: () => sheetId,
    list: table => read()[table] || [],
    get: (table, id) => (read()[table] || []).find(r => r.id === id) || null,
    insert(table, record) {
      const data = read();
      if (!data[table]) throw new Error('Missing table');
      if (data[table].some(r => r.id === record.id)) throw new Error('Duplicate id');
      data[table].push(record); save(data);
    },
    update(table, id, record) {
      const data = read(), index = data[table].findIndex(r => r.id === id);
      if (index < 0 || record.id !== id) throw new Error('Missing/changed id');
      data[table][index] = record; save(data);
    }
  };
}
function createLocalLock(shared = { held: false }) {
  return { acquire() { if (shared.held) return false; shared.held = true; return true; }, release() { shared.held = false; } };
}
module.exports = { createFileStore, createLocalLock };
