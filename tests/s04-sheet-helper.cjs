const fs = require('node:fs');
const crypto = require('node:crypto');
const schema = require('../schema/tables.json');
const { DEV_SHEET_ID, canonical, commandRequest } = require('../s04/processor.js');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function sheetEnvironment() {
  const data = JSON.parse(fs.readFileSync('fixtures/s04-local.json', 'utf8'));
  const calls = { opens: 0, writes: [], flush: 0, locks: 0, releases: 0, named: 0, taskReadsUnlocked: 0 };
  let held = false;
  const grids = {}, sheets = {};
  for (const name of Object.keys(data)) {
    const headers = schema.tables.find(t => t.name === name).columns.map(c => c.name);
    grids[name] = [headers, ...data[name].map(row => headers.map(h => row[h] ?? ''))];
    sheets[name] = {
      getName: () => name,
      getLastColumn: () => grids[name][0].length,
      getLastRow: () => grids[name].length,
      getMaxRows: () => 1000,
      getRange(row, col, height = 1, width = 1) {
        return {
          getValues() {
            if (name === 'Tasks' && row > 1 && !held) calls.taskReadsUnlocked++;
            return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => grids[name][row - 1 + r]?.[col - 1 + c] ?? ''));
          },
          setValues(values) {
            if (!held) throw new Error('write without script lock');
            if (values.length !== height || values.some(r => r.length !== width)) throw new Error('range shape mismatch');
            calls.writes.push(name);
            values.forEach((r, ri) => r.forEach((v, ci) => {
              if (typeof v === 'string' && v.startsWith('=')) throw new Error('formula executed');
              const literal = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
              if (!grids[name][row - 1 + ri]) grids[name][row - 1 + ri] = [];
              grids[name][row - 1 + ri][col - 1 + ci] = literal;
            }));
          }
        };
      }
    };
  }
  const ss = { getId: () => DEV_SHEET_ID, getSheets: () => Object.values(sheets),
    getSheetByName() { calls.named++; throw new Error('Sheet 0 not found'); } };
  const config = { environment: 'DEV', sheetId: DEV_SHEET_ID, projectId: 'S04-test-project' };
  const secret = 'only-a-local-test-secret-01234567890123456789';
  const properties = { S04_CONFIG: JSON.stringify(config), S04_IDENTITY_SECRET: secret };
  const lock = { tryLock() { calls.locks++; if (held) return false; held = true; return true; }, releaseLock() { calls.releases++; held = false; } };
  const services = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null }) },
    ScriptApp: { getScriptId: () => config.projectId },
    SpreadsheetApp: { openById(id) { if (id !== DEV_SHEET_ID) throw new Error('wrong sheet'); calls.opens++; return ss; }, flush() { calls.flush++; } },
    LockService: { getScriptLock: () => lock },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest())
    }
  };
  function proof(command, overrides = {}) {
    const now = Date.now();
    const p = { version: 'S04-IDENTITY-2', purpose: 'S04_COMPLETE_TASK', subject: 'office@s04.example.invalid', jti: 'test-jti-0123456789', email: 'office@s04.example.invalid', audience: 'S04:' + config.projectId + ':' + DEV_SHEET_ID,
      issued_at: now, expires_at: now + 60000, request_hash: hash(canonical(commandRequest(command))), ...overrides };
    p.signature = crypto.createHmac('sha256', secret).update(canonical(p)).digest('hex');
    return p;
  }
  function records(name) { return grids[name].slice(1).map(row => Object.fromEntries(grids[name][0].map((h, i) => [h, row[i] === '' ? null : row[i]]))); }
  function change(name, id, field, value) {
    const grid = grids[name], index = grid[0].indexOf(field), row = grid.find((r, i) => i > 0 && r[grid[0].indexOf('id')] === id);
    if (!row || index < 0) throw new Error('fixture row/field missing'); row[index] = value;
  }
  return { services, config, properties, grids, ss, sheets, calls, proof, records, change, lock };
}
module.exports = { sheetEnvironment, clone, schema };
