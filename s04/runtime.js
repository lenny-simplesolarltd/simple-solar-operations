/* Server runtime wiring; no identity is inferred from app-owner Session. */
const { createProcessor, DEV_SHEET_ID } = require('./processor.js');
const { createSignedActorProvider } = require('./identity.js');
const { createSheetStore } = require('./sheet-store.js');
function execute(services, schema, commandJson, proofJson) {
  try {
    const properties = services.PropertiesService.getScriptProperties();
    const config = JSON.parse(properties.getProperty('S04_CONFIG') || 'null');
    if (!config || config.environment !== 'DEV') return { status: 'Failed', error: 'DEV_ONLY', committed: false };
    if (config.sheetId !== DEV_SHEET_ID) return { status: 'Failed', error: 'SHEET_ID_MISMATCH', committed: false };
    if (!config.projectId || config.projectId !== services.ScriptApp.getScriptId()) return { status: 'Failed', error: 'PROJECT_ID_MISMATCH', committed: false };
    const input = JSON.parse(commandJson), proof = JSON.parse(proofJson || 'null');
    const hex = bytes => bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    const u = services.Utilities;
    const sha256 = text => hex(u.computeDigest(u.DigestAlgorithm.SHA_256, text, u.Charset.UTF_8));
    const hmac = (text, secret) => hex(u.computeHmacSha256Signature(text, secret, u.Charset.UTF_8));
    const actorProvider = createSignedActorProvider({ proof, secret: properties.getProperty('S04_IDENTITY_SECRET'),
      audience: 'S04:' + config.projectId + ':' + config.sheetId, now: () => Date.now(), sha256, hmac });
    // Verify before opening any workbook as well as inside the processor boundary.
    const { commandRequest } = require('./processor.js');
    actorProvider.getIdentity(commandRequest(input));
    const ss = services.SpreadsheetApp.openById(config.sheetId);
    const store = createSheetStore(ss, schema, () => services.SpreadsheetApp.flush());
    const lock = services.LockService.getScriptLock();
    return createProcessor({ config, store, projectId: () => services.ScriptApp.getScriptId(),
      actorProvider, sha256, now: () => new Date().toISOString(),
      lock: { acquire: () => lock.tryLock(5000), release: () => lock.releaseLock() }
    }).process(input);
  } catch (e) {
    return { status: 'Failed', committed: false, accepted: false, error: e.code || 'S04_RUNTIME_REFUSED' };
  }
}
module.exports = { execute };
