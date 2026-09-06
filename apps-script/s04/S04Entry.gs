/* Standalone DEV project only. No web endpoint or trigger installed here.
 * Proof must come from a trusted issuer, never a client-side signing secret. */
function runS04CompleteTaskCommand(commandJson, identityProofJson) {
  return S04.execute({
    PropertiesService: PropertiesService,
    ScriptApp: ScriptApp,
    SpreadsheetApp: SpreadsheetApp,
    LockService: LockService,
    Utilities: Utilities
  }, commandJson, identityProofJson);
}

/* Backend web-app: owner execution provides storage access only. Identity still
 * requires a valid bridge proof; no Session or request email fallback. */
function doPost(e) {
  var result;
  try {
    if (!e || !e.postData || e.postData.contents.length > 16000) throw new Error('Invalid request');
    var body = JSON.parse(e.postData.contents);
    if (!body || Object.keys(body).some(function(k) { return k !== 'command' && k !== 'proof'; })) throw new Error('Invalid fields');
    result = runS04CompleteTaskCommand(JSON.stringify(body.command), JSON.stringify(body.proof));
  } catch (_) {
    result = { status: 'Failed', committed: false, error: 'S04_TRANSPORT_REFUSED' };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
