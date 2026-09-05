const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const guard = require('../apps-script/OutboundGuard.js');
const fixture = require('../fixtures/s01-probes.json');
const template = require('../config/environment.example.json');
const config = {...template, allowedRecipients:[fixture.approved], allowedCalendarIds:[fixture.calendarId]};
for (const request of fixture.requests) {
  test(request.kind + ': allowed capture succeeds without a transport call', () => {
    const result = guard.dispatch(config, request, () => assert.fail('capture called transport'));
    assert.equal(result.status, 'CAPTURED'); assert.equal(result.deliveryConfirmed, false);
  });
  test(request.kind + ': mixed approved and unapproved recipients refused before transport', () => {
    assert.throws(() => guard.dispatch({...config,mode:'PROBE',probeEnabled:true}, {...request,to:[fixture.approved,fixture.outsideAllowlist]}, () => assert.fail('unsafe send')), /outside allowlist/);
  });
}
test('CC and BCC cannot bypass allowlist', () => {
  for (const key of ['cc','bcc']) assert.throws(() => guard.authorize(config,{...fixture.requests[0],[key]:[fixture.outsideAllowlist]}), /outside allowlist/);
});
test('reject display names, lists, wildcards, whitespace and header injection', () => {
  for (const recipient of ['Test <approved@example.invalid>','approved@example.invalid,outside@example.invalid','*@example.invalid','approved@example.invalid\r\nBcc:outside@example.invalid',' approved@example.invalid']) {
    assert.throws(() => guard.authorize(config,{kind:'EMAIL',to:[recipient]}), /invalid mailbox/);
  }
});
test('bare mailbox case normalization works without alias or domain matching', () => {
  assert.equal(guard.authorize(config,{kind:'EMAIL',to:['APPROVED@example.invalid']}).to[0],fixture.approved);
  assert.throws(() => guard.authorize(config,{kind:'EMAIL',to:['approved+other@example.invalid']}), /outside allowlist/);
});
test('missing configuration, invalid environments and PROD fail closed', () => {
  for (const value of [null,{}, {...config,environment:'PROD'}, {...config,environment:'test'}, {...config,timezone:'UTC'}, {...config,mode:'LIVE'}, {...config,allowedRecipients:[]}]) {
    assert.throws(() => guard.dispatch(value,fixture.requests[0],()=>assert.fail('unsafe send')), /S01_REFUSED/);
  }
});
test('PROBE requires explicit enablement', () => {
  assert.throws(() => guard.dispatch({...config,mode:'PROBE'},fixture.requests[0],()=>assert.fail('disabled send')), /probe disabled/);
});
test('calendar target is independently restricted', () => {
  assert.throws(() => guard.authorize(config,{...fixture.requests[1],calendarId:'different-calendar'}), /calendar outside allowlist/);
});
test('reject unsupported channels and undeclared routing fields', () => {
  for (const request of [{kind:'XERO',to:[fixture.approved]}, {...fixture.requests[0],replyTo:fixture.outsideAllowlist}, {...fixture.requests[1],bcc:[fixture.outsideAllowlist]}, {kind:'EMAIL',to:[]}, {kind:'EMAIL',to:fixture.approved}]) assert.throws(() => guard.authorize(config,request), /S01_REFUSED/);
});
function harness(cfg, request, owned = true) {
  const calls = [];
  const context = vm.createContext({console:{log(){}}, PropertiesService:{getScriptProperties:()=>({getProperty:key=>JSON.stringify(key==='S01_CONFIG'?cfg:request)})},ScriptApp:{getScriptId:()=> 'synthetic-script'},Utilities:{getUuid:()=> 'synthetic-probe'},MailApp:{sendEmail:message=>calls.push(['email',message])},CalendarApp:{getCalendarById:id=>({isOwnedByMe:()=>owned,isMyPrimaryCalendar:()=>false,getTimeZone:()=> 'Europe/London',createEvent:(...args)=>{calls.push(['calendar',id,...args]);return {getId:()=> 'synthetic-event'};}})}});
  for (const path of ['OutboundGuard.js','S01Probe.js']) vm.runInContext(fs.readFileSync('apps-script/'+path,'utf8'),context);
  return {run:()=>context.runS01Probe(),calls};
}
for (const request of fixture.requests) {
  test(request.kind + ': probe wrapper submits through stub only and does not claim receipt', () => {
    const h = harness({...config,scriptProjectId:'synthetic-script',mode:'PROBE',probeEnabled:true},request);
    const result = h.run(); assert.equal(h.calls.length,1); assert.equal(result.status,'SUBMITTED'); assert.equal(result.deliveryConfirmed,false);
    if(request.kind==='CALENDAR') {assert.equal(h.calls[0][5].sendInvites,true);}
  });
  test(request.kind + ': wrapper refuses unapproved destination with no side effect', () => {
    const h=harness({...config,scriptProjectId:'synthetic-script',mode:'PROBE',probeEnabled:true},{...request,to:[fixture.outsideAllowlist]});
    assert.throws(h.run,/outside allowlist/);assert.equal(h.calls.length,0);
  });
}
test('wrapper refuses wrong project and non-owned calendar',()=> {
  for (const [id,owned] of [['wrong-project',true],['synthetic-script',false]]) {
    const h=harness({...config,scriptProjectId:id,mode:'PROBE',probeEnabled:true},fixture.requests[1],owned);
    assert.throws(h.run,/S01_REFUSED/);assert.equal(h.calls.length,0);
  }
});
