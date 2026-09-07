/* DEV-only Apps Script entry points. No generic mutation and no PROD fallback. */
function _r1aCloudOptions(){
  var store=_s17CloudStore();
  return {store:store,config:{environment:'DEV',sheetId:R1A_DEV_SHEET_ID},actorEmail:function(){return Session.getActiveUser().getEmail();},reads:{officeHome:_s17OfficeToday,jobOverview:_s17JobOverview,operationalQueue:_s17OperationalQueue,releaseModes:_s17AdminReleaseModes,systemStatus:_s17AdminSystemStatus,auditHistory:_s17AuditHistory,actionAvailability:_s17ActionAvailability,taskActionAvailability:_s17TaskActionAvailability},services:{}};
}
function appSheetR1Read(requestJson){try{return JSON.stringify(_r1aCreate(_r1aCloudOptions()).read(JSON.parse(requestJson)));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}
function appSheetR1Command(requestJson){try{return JSON.stringify(_r1aCreate(_r1aCloudOptions()).command(JSON.parse(requestJson)));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}
