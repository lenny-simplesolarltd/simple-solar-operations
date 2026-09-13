const fs = require('node:fs'), schema = require('../schema/tables.json');
const { buildS05Core } = require('./build-s05.cjs');

const R1A_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const names = schema.tables.map(t => t.name);
const headers = Object.fromEntries(names.map(n => [n, schema.tables.find(t => t.name === n).columns.map(c => c.name)]));

function stripModuleExports(src) {
  // Remove 'use strict' directives
  src = src.replace(/^'use strict';\s*/gm, '');
  // Find the last function or statement before the module export, strip everything from there
  // Strategy: find the first line that starts with 'if(typeof module' or 'module.exports' and remove from there
  var lines = src.split('\n');
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*if\s*\(\s*typeof\s+module/.test(line) || /^\s*module\.exports\s*=/.test(line)) {
      break;
    }
    result.push(line);
  }
  return result.join('\n').replace(/\n+$/, '\n');
}

// Source files for the standalone bridge, in dependency order
const sourceFiles = [
  's17/admin.js',
  's10/operations.js',
  's11/planner.js',
  's15/cancellation.js',
  's06/gates.js',
  's13/payments.js',
  'installer/workflow.js',
  'materials/workflow.js',
  'r1-appsheet/operations-contract.js',
  'r1-appsheet/operations-requests.js',
  'r1-appsheet/adapter.js',
  'r1-appsheet/services.js',
  'r1-appsheet/request-row.js',
];

// Standalone cloud store (uses openById — safe in non-bound standalone projects)
const standaloneCloud = `
/* Standalone cloud store. Uses openById — safe in non-bound standalone projects. */
var S17_HEADERS = ${JSON.stringify(headers)};
function _s17Cell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\\-]/.test(value) ? "'" + value : value; }
function _s17CloudGuard() {
  var ss = SpreadsheetApp.openById('${R1A_DEV_SHEET_ID}');
  if (ss.getId() !== '${R1A_DEV_SHEET_ID}') throw new Error('S17_REFUSED: exact DEV sheet required');
  return ss;
}
function _s17Sheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('S17_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], h = S17_HEADERS[name];
  if (!h || sh.getLastColumn() !== h.length || JSON.stringify(sh.getRange(1, 1, 1, h.length).getValues()[0]) !== JSON.stringify(h))
    throw new Error('S17_SCHEMA: header mismatch ' + name);
  return sh;
}
function _s17CloudStore() {
  var ss = _s17CloudGuard();
  function list(name) {
    var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _s17CloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('S17_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    },
    insert: function (name, row) {
      var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('S17_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('S17_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && !h.includes(k)) throw new Error('S17_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _s17Cell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues();
      var indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('S17_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) {
        if (!patch.hasOwnProperty(k)) continue;
        if (!h.includes(k)) throw new Error('S17_SCHEMA: unknown field ' + name + '.' + k);
        row[h.indexOf(k)] = patch[k];
      }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_s17Cell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { try { return fn(); } finally {} }
  };
}
`;

// R1 cloud options for standalone (overrides withLock with ScriptLock)
const standaloneCloudOptions = `
/* Standalone R1 cloud options. */
function _r1aCloudOptions(){
  var store=_s17CloudStore();
  store.withLock=function(fn){var lock=LockService.getScriptLock();lock.waitLock(30000);try{return fn();}finally{lock.releaseLock();}};
  return {store:store,config:{environment:'DEV',sheetId:'1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc'},actorEmail:function(){return Session.getActiveUser().getEmail();},effectiveUserEmail:function(){return Session.getEffectiveUser().getEmail();},reads:_r1aDefaultReads(),services:_r1sServices()};
}
function appSheetR1Read(requestJson,actorEmail){try{var request=JSON.parse(requestJson);return JSON.stringify(R1C_READS.indexOf(request.read_type)>=0?_r1cReadCloud(request,actorEmail):_r1aCreate(_r1aCloudOptions()).read(request));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}
function appSheetR1Command(requestJson){try{return JSON.stringify(_r1aCreate(_r1aCloudOptions()).command(JSON.parse(requestJson)));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}
`;

const sourceContent = sourceFiles.map(f => {
  let src = fs.readFileSync(f, 'utf8');
  src = stripModuleExports(src);
  if (f === 's06/gates.js') {
    src = src.replace(/\bconst DEV_SHEET_ID\b/g, 'const S06_DEV_SHEET_ID').replace(/\bDEV_SHEET_ID\b/g, 'S06_DEV_SHEET_ID');
    src = src.replace(/\bfunction clone\b/g, 'function _s06Clone').replace(/\bconst clone\b/g, 'const _s06Clone').replace(/\bclone\(/g, '_s06Clone(');
  }
  if (f === 's13/payments.js') {
    src = src.replace(/\bconst DEV_SHEET_ID\b/g, 'const S13_DEV_SHEET_ID').replace(/\bDEV_SHEET_ID\b/g, 'S13_DEV_SHEET_ID');
    src = src.replace(/\bfunction clone\b/g, 'function _s13Clone').replace(/\bconst clone\b/g, 'const _s13Clone').replace(/\bclone\(/g, '_s13Clone(');
  }
  return src;
}).join('\n').replace(/R1A_BOUND_/g, 'R1A_');

const output = '/* Generated by npm run build:standalone-bridge. DEV only. Standalone AppSheet bridge. */\n' +
  standaloneCloud + '\n' + require('./operations-dependencies.cjs').operationsDependencies() + '\n' +
  buildS05Core() + '\n' +
  sourceContent + '\n' +
  standaloneCloudOptions;

fs.mkdirSync('standalone-bridge', { recursive: true });
fs.writeFileSync('standalone-bridge/AppSheetBridge.js', output);
console.log('Standalone bridge written to standalone-bridge/AppSheetBridge.js');
