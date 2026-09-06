function bridgeServices_() {
  return { PropertiesService: PropertiesService, ScriptApp: ScriptApp, Session: Session,
    LockService: LockService, Utilities: Utilities, UrlFetchApp: UrlFetchApp };
}
function doGet(e) {
  try {
    var model = S04Bridge.createBridge(bridgeServices_()).begin(e.parameter.task_id, e.parameter.expected_version);
    var page = HtmlService.createTemplateFromFile('CompleteTask');
    page.model = model;
    return page.evaluate().setTitle('Complete synthetic DEV task');
  } catch (_) {
    return HtmlService.createHtmlOutput('Access refused. Open the DEV action using your approved individual Google account.');
  }
}
function submitS04BridgeCommand(challenge, note) {
  return S04Bridge.createBridge(bridgeServices_()).submit(challenge, note);
}
