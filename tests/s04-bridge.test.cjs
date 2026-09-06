const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createBridge } = require('../s04/bridge.js');
const { createSignedActorProvider } = require('../s04/identity.js');
const { canonical, commandRequest } = require('../s04/processor.js');
const { execute } = require('../s04/runtime.js');
const { buildBridge } = require('../scripts/build-s04.cjs');
const { sheetEnvironment, schema } = require('./s04-sheet-helper.cjs');
function fixture(factory = createBridge) {
  const backend = sheetEnvironment();
  const state = { active: 'office@s04.example.invalid', effective: 'office@s04.example.invalid', calls: [] };
  const perUser = {};
  const config = { environment: 'DEV', bridgeProjectId: 'bridge-project', backendProjectId: backend.config.projectId,
    sheetId: backend.config.sheetId, backendUrl: 'https://script.google.com/macros/s/dev-deployment/exec',
    allowedUsers: ['office@s04.example.invalid', 'admin@s04.example.invalid', 'installer@s04.example.invalid'] };
  const props = { S04_BRIDGE_CONFIG: JSON.stringify(config), S04_IDENTITY_SECRET: backend.properties.S04_IDENTITY_SECRET };
  let locked = false;
  const services = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => props[k] }),
      getUserProperties: () => {
        const user = state.active; perUser[user] ||= {};
        return { getProperty: k => perUser[user][k], setProperty: (k, v) => { perUser[user][k] = v; } };
      }
    },
    ScriptApp: { getScriptId: () => 'bridge-project' },
    Session: { getActiveUser: () => ({ getEmail: () => state.active }), getEffectiveUser: () => ({ getEmail: () => state.effective }) },
    LockService: { getUserLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    Utilities: { ...backend.services.Utilities, getUuid: () => crypto.randomUUID() },
    UrlFetchApp: { fetch(url, options) {
      state.calls.push({ url, options });
      const body = JSON.parse(options.payload);
      const result = execute(backend.services, schema, JSON.stringify(body.command), JSON.stringify(body.proof));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(result) };
    } }
  };
  return { bridge: factory(services), backend, state, perUser, props, config, services };
}
for (const mode of ['local', 'packaged']) test('S04 ' + mode + ' bridge authenticates user and completes through backend', () => {
  let factory = createBridge;
  if (mode === 'packaged') { const ctx = vm.createContext({}); vm.runInContext(buildBridge(), ctx); factory = ctx.S04Bridge.createBridge; }
  const f = fixture(factory), page = f.bridge.begin('T-open', '1');
  assert.equal(page.email, 'office@s04.example.invalid');
  assert.equal(f.backend.calls.opens, 0); // GET never reads/mutates Sheets.
  const result = f.bridge.submit(page.challenge, 'Confirmed by actual user');
  assert.equal(result.status, 'Committed', JSON.stringify(result));
  assert.equal(f.backend.records('TaskEvents')[0].actor, 'P-office');
  assert.equal(f.backend.records('AuditEvents')[0].initiating_actor, 'P-office');
  const sent = JSON.parse(f.state.calls[0].options.payload);
  assert.equal(sent.proof.subject, page.email); assert.equal(sent.proof.purpose, 'S04_COMPLETE_TASK');
  assert.equal(sent.proof.expires_at - sent.proof.issued_at, 120000); assert.ok(sent.proof.jti);
  assert.equal(result.signature, undefined); assert.equal(result.proof, undefined);
  assert.equal(f.bridge.submit(page.challenge, 'Confirmed by actual user').status, 'Committed');
  assert.equal(f.backend.records('TaskEvents').length, 1);
});
test('S04 bridge wrong user cannot submit another user challenge', () => {
  const f = fixture(), p = f.bridge.begin('T-open', 1);
  f.state.active = f.state.effective = 'admin@s04.example.invalid';
  assert.equal(f.bridge.submit(p.challenge, 'Forged').error, 'CHALLENGE_EXPIRED_OR_WRONG_USER');
  assert.equal(f.state.calls.length, 0);
});
for (const [active, effective] of [['', 'admin@s04.example.invalid'], ['office@s04.example.invalid', 'admin@s04.example.invalid']]) {
  test('S04 bridge rejects app-owner fallback/misdeployment: ' + (active || 'blank'), () => {
    const f = fixture(); f.state.active = active; f.state.effective = effective;
    assert.throws(() => f.bridge.begin('T-open', 1), /ACCESSING_GOOGLE_USER_REQUIRED/);
    assert.equal(f.state.calls.length, 0);
  });
}
test('S04 bridge rejects unallowlisted authenticated Google user', () => {
  const f = fixture(); f.state.active = f.state.effective = 'stranger@s04.example.invalid';
  assert.throws(() => f.bridge.begin('T-open', 1), /BRIDGE_USER_DENIED/);
});
test('S04 bridge installer identity cannot become office actor at backend', () => {
  const f = fixture(); f.state.active = f.state.effective = 'installer@s04.example.invalid';
  const p = f.bridge.begin('T-open', 1); assert.equal(f.bridge.submit(p.challenge, 'Done').error, 'PERMISSION_DENIED');
  assert.equal(f.backend.calls.writes.length, 0);
});
test('S04 bridge rejects changed payload on an already-bound confirmation', () => {
  const f = fixture(), p = f.bridge.begin('T-open', 1); f.bridge.submit(p.challenge, 'First');
  assert.equal(f.bridge.submit(p.challenge, 'Changed').error, 'CHALLENGE_ALREADY_BOUND');
  assert.equal(f.state.calls.length, 1);
});
test('S04 bridge challenge expiry denies before dispatch', () => {
  const f = fixture(), p = f.bridge.begin('T-open', 1);
  const state = JSON.parse(f.perUser[f.state.active].S04_PENDING); state.expires_at = 1;
  f.perUser[f.state.active].S04_PENDING = JSON.stringify(state);
  assert.equal(f.bridge.submit(p.challenge, 'Done').error, 'CHALLENGE_EXPIRED_OR_WRONG_USER'); assert.equal(f.state.calls.length, 0);
});
test('S04 bridge refresh preserves uncertain command and rotates challenge', () => {
  const f = fixture(), p = f.bridge.begin('T-open', 1), original = f.services.UrlFetchApp.fetch;
  f.services.UrlFetchApp.fetch = (...args) => { original(...args); throw new Error('reply lost'); };
  assert.equal(f.bridge.submit(p.challenge, 'Once').status, 'Pending');
  const first = JSON.parse(f.state.calls[0].options.payload).command;
  assert.throws(() => f.bridge.begin('T-complete', 2), /RESOLVE_PENDING_COMMAND_FIRST/);
  const refreshed = f.bridge.begin('T-open', 1); assert.equal(refreshed.resumed, true); assert.equal(refreshed.note, 'Once');
  assert.notEqual(refreshed.challenge, p.challenge);
  assert.equal(f.bridge.submit(p.challenge, 'Once').error, 'CHALLENGE_EXPIRED_OR_WRONG_USER');
  f.services.UrlFetchApp.fetch = original;
  assert.equal(f.bridge.submit(refreshed.challenge, 'Once').status, 'Committed');
  assert.deepEqual(JSON.parse(f.state.calls[1].options.payload).command, first);
  assert.equal(f.backend.records('TaskEvents').length, 1);
});
for (const field of ['environment', 'bridgeProjectId', 'backendUrl', 'sheetId']) test('S04 bridge rejects unsafe config: ' + field, () => {
  const f = fixture(); f.props.S04_BRIDGE_CONFIG = JSON.stringify({ ...f.config, [field]: 'wrong' });
  assert.throws(() => f.bridge.begin('T-open', 1), /BRIDGE_DEV_CONFIG_REQUIRED/);
});
function validProof() {
  const f = fixture(), page = f.bridge.begin('T-open', 1); f.bridge.submit(page.challenge, 'Done');
  return { f, ...JSON.parse(f.state.calls[0].options.payload) };
}
for (const name of ['email', 'subject', 'purpose', 'jti', 'audience', 'signature', 'expired', 'payload', 'missing signature', 'legacy v1']) {
  test('S04 backend rejects proof misuse: ' + name, () => {
    const { f, command, proof } = validProof();
    if (name === 'expired') proof.expires_at = 1;
    else if (name === 'payload') command.payload.completion_note = 'Changed by replay';
    else if (name === 'missing signature') delete proof.signature;
    else if (name === 'legacy v1') proof.version = 'S04-IDENTITY-1';
    else proof[name] = 'tampered';
    assert.equal(execute(f.backend.services, schema, JSON.stringify(command), JSON.stringify(proof)).error, 'TRUSTED_IDENTITY_REQUIRED');
    assert.equal(f.backend.records('TaskEvents').length, 1);
  });
}
test('S04 exact proof replay is permitted only as same-command idempotent replay', () => {
  const { f, command, proof } = validProof();
  assert.equal(execute(f.backend.services, schema, JSON.stringify(command), JSON.stringify(proof)).status, 'Committed');
  command.command_id = 'CMD-other';
  assert.equal(execute(f.backend.services, schema, JSON.stringify(command), JSON.stringify(proof)).error, 'TRUSTED_IDENTITY_REQUIRED');
  assert.equal(f.backend.records('TaskEvents').length, 1);
});
test('S04 backend doPost parses only signed transport envelope', () => {
  const f = fixture(); const ctx = vm.createContext({ ...f.backend.services, ContentService: {
    MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } })
  } });
  vm.runInContext(fs.readFileSync('apps-script/s04/S04Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s04/S04Entry.gs', 'utf8'), ctx);
  const body = { command: {}, actor_email: 'admin@s04.example.invalid' };
  const result = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  assert.equal(result.error, 'S04_TRANSPORT_REFUSED'); assert.equal(f.backend.calls.opens, 0);
});
test('S04 bridge package is synchronised, excludes Sheet code and uses accessing-user deployment', () => {
  assert.equal(fs.readFileSync('apps-script/s04-bridge/BridgeCore.gs', 'utf8'), buildBridge());
  assert.doesNotMatch(buildBridge(), /require\(|module\.exports|SpreadsheetApp|createSheetStore/);
  const bridge = JSON.parse(fs.readFileSync('apps-script/s04-bridge/appsscript.json'));
  assert.equal(bridge.webapp.executeAs, 'USER_ACCESSING'); assert.equal(bridge.webapp.access, 'ANYONE');
  assert.ok(!bridge.oauthScopes.some(s => s.endsWith('/spreadsheets')));
  const backend = JSON.parse(fs.readFileSync('apps-script/s04/appsscript.json'));
  assert.equal(backend.webapp.executeAs, 'USER_DEPLOYING');
});
