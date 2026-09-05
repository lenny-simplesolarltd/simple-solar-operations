/* Manually invoked only in a NEW isolated company-owned S01 project.
 * No triggers, web endpoints, arbitrary message contents or production mode.
 */
function runS01Probe() {
  var properties = PropertiesService.getScriptProperties();
  var config = JSON.parse(properties.getProperty('S01_CONFIG') || 'null');
  var request = JSON.parse(properties.getProperty('S01_REQUEST') || 'null');
  if (!config || !config.scriptProjectId || config.scriptProjectId !== ScriptApp.getScriptId()) {
    throw new Error('S01_REFUSED: project identity mismatch');
  }
  var result = S01Guard.dispatch(config, request, function (safe) {
    var label = 'S01 SYNTHETIC TEST ' + Utilities.getUuid();
    if (safe.kind === 'EMAIL') {
      MailApp.sendEmail({to:safe.to.join(','), cc:safe.cc.join(','), bcc:safe.bcc.join(','), subject:label, body:'Synthetic S01 environment verification only. No customer, order or invoice.'});
      return {probeLabel:label};
    }
    var calendar = CalendarApp.getCalendarById(safe.calendarId);
    if (!calendar || !calendar.isOwnedByMe() || calendar.isMyPrimaryCalendar() || calendar.getTimeZone() !== 'Europe/London') throw new Error('S01_REFUSED: calendar must be owned, secondary and Europe/London');
    var start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    var event = calendar.createEvent(label, start, new Date(start.getTime() + 15 * 60 * 1000), {
      description:'Synthetic S01 environment verification only.', guests:safe.to.join(','),
      sendInvites:true
    });
    return {probeLabel:label, eventId:event.getId()};
  });
  console.log(JSON.stringify(result));
  return result;
}
