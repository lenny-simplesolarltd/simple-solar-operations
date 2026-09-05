/* S01 only. No business workflow, network calls or production delivery path. */
var S01Guard = (function () {
  'use strict';
  function fail(reason) { throw new Error('S01_REFUSED: ' + reason); }
  function address(value) {
    // Deliberately narrow: one bare mailbox, no names, lists, control chars or wildcards.
    if (typeof value !== 'string' || !/^[A-Za-z0-9_+.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)) fail('invalid mailbox');
    return value.toLowerCase();
  }
  function list(value, label) {
    if (!Array.isArray(value)) fail(label + ' must be an array');
    return value.map(address);
  }
  function authorize(config, request) {
    if (!config || !['DEV', 'TEST'].includes(config.environment)) fail('environment must be DEV or TEST; PROD is unavailable');
    if (config.timezone !== 'Europe/London') fail('timezone');
    if (!['CAPTURE', 'PROBE'].includes(config.mode)) fail('mode');
    if (config.mode === 'PROBE' && config.probeEnabled !== true) fail('probe disabled');
    if (!request || !['EMAIL', 'CALENDAR'].includes(request.kind)) fail('unsupported action');
    var keys = request.kind === 'EMAIL' ? ['kind', 'to', 'cc', 'bcc'] : ['kind', 'to', 'calendarId'];
    if (Object.keys(request).some(function (key) { return !keys.includes(key); })) fail('unsupported request field');
    var approved = list(config.allowedRecipients, 'allowlist');
    if (!approved.length) fail('empty allowlist');
    var to = list(request.to, 'to');
    var cc = request.kind === 'EMAIL' ? list(request.cc === undefined ? [] : request.cc, 'cc') : [];
    var bcc = request.kind === 'EMAIL' ? list(request.bcc === undefined ? [] : request.bcc, 'bcc') : [];
    if (!to.length) fail('no destination');
    if (to.concat(cc, bcc).some(function (email) { return !approved.includes(email); })) fail('destination outside allowlist');
    if (request.kind === 'CALENDAR') {
      if (typeof request.calendarId !== 'string' || !request.calendarId || !Array.isArray(config.allowedCalendarIds) || !config.allowedCalendarIds.includes(request.calendarId)) fail('calendar outside allowlist');
    }
    return Object.freeze({kind:request.kind, to:Object.freeze(to), cc:Object.freeze(cc), bcc:Object.freeze(bcc), calendarId:request.calendarId});
  }
  function dispatch(config, request, transport) {
    var safe = authorize(config, request);
    if (config.mode === 'CAPTURE') return {status:'CAPTURED', deliveryConfirmed:false, request:safe};
    if (typeof transport !== 'function') fail('transport missing');
    // A transport response proves only submission. Receipt needs separate human evidence.
    return {status:'SUBMITTED', deliveryConfirmed:false, transportResult:transport(safe)};
  }
  return Object.freeze({authorize:authorize, dispatch:dispatch});
}());
if (typeof module !== 'undefined') module.exports = S01Guard;
