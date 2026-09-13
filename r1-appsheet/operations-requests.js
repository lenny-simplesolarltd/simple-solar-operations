/* Only four new helper tables. They are not operational tables and are provisioned separately from S02. */
'use strict';
var R1C_INSTALLER_FIELDS = ['note','reason','outcome','actual_end','return_reason','category','description','submission_id','expected_submission_version','review_status','review_notes','evidence_path','question_key','value_text','value_number','value_date','value_boolean','not_applicable_reason'];
var R1C_REQUEST_HEADERS = {
  DEVInstallerCommandRequests: ['id','command_id','command_type','job_id','work_package_id','expected_version','submitted_by','status'].concat(R1C_INSTALLER_FIELDS),
  DEVGoodsInRequests: ['id','command_id','job_id','delivery_id','expected_version','submitted_by','status','line_count','delivery_note_reference','delivery_note_path','discrepancy_note'],
  DEVGoodsInRequestLines: ['id','request_id','order_line_id','quantity_good','quantity_damaged','quantity_short','evidence_id'],
  DEVStockCommandRequests: ['id','command_id','command_type','product_id','expected_version','expected_balance','quantity','reason','evidence_id','submitted_by','status']
};
function _r1cContracts() { return typeof R1C_COMMANDS !== 'undefined' ? R1C_COMMANDS : require('./operations-contract.js').R1C_COMMANDS; }
function _r1cRequestTable(type) { if(!_r1cContracts()[type])return null;return type==='GOODS_IN_RECEIVE'?'DEVGoodsInRequests':type==='STOCK_QUARANTINE'?'DEVStockCommandRequests':'DEVInstallerCommandRequests'; }
function _r1cRequestError(code){var e=new Error(code);e.code=code;throw e;}
function _r1cConfigGuard(){var c=JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG')||'null');if(!c||c.environment!=='DEV'||c.sheetId!==R1A_REQUEST_DEV_SHEET)_r1cRequestError('R1C_DEV_ONLY');return c;}
function _r1cRows(ss,name){
  if(ss.getId()!==R1A_REQUEST_DEV_SHEET)_r1cRequestError('R1C_DEV_ONLY');
  var matches=ss.getSheets().filter(function(sh){return sh.getName()===name;});if(matches.length!==1)_r1cRequestError('R1C_REQUEST_TABLE_MISSING');
  var sh=matches[0],h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0],required=R1C_REQUEST_HEADERS[name];
  if(h.some(function(k,i){return !k||h.indexOf(k)!==i;})||required.some(function(k){return h.indexOf(k)<0;}))_r1cRequestError('R1C_REQUEST_SCHEMA');
  if(sh.getLastRow()<2)return[];
  return sh.getRange(2,1,sh.getLastRow()-1,h.length).getValues().map(function(row){var r={};h.forEach(function(k,i){r[k]=row[i];});return r;}).filter(function(r){return r.id;});
}
/* Resolve an AppSheet File/Image relative path only within the configured DEV upload root.
 * Reads file metadata; never creates/moves/shares files. AppSheet owns upload, backend owns Evidence.
 * AppSheet writes the request row (and fires the bot) before the uploaded file is necessarily visible
 * through Drive, so a missing folder/file is R1C_UPLOAD_PENDING (retryable, e.retryable=true), never a
 * validation failure. _r1cResolveUpload waits briefly in-call (bounded, before any write); the persistent
 * bounded retry lives in upload-retry.js. Path validation errors are permanent and are never retried. */
var R1C_UPLOAD_WAIT_MS=[2000,4000,6000];
function _r1cUploadPending(attempts){var e=new Error('R1C_UPLOAD_PENDING');e.code='R1C_UPLOAD_PENDING';e.retryable=true;e.attempts=attempts;throw e;}
function _r1cResolveUploadOnce(path){
  var c=_r1cConfigGuard();if(!c.evidenceFolderId)_r1cRequestError('R1C_UPLOAD_ROOT_NOT_CONFIGURED');
  if(typeof path!=='string'||!path.trim()||/^[\/]|\\|:|%/.test(path))_r1cRequestError('R1C_UPLOAD_PATH_INVALID');
  var parts=path.split('/');if(parts.some(function(p){return !p||p==='.'||p==='..';}))_r1cRequestError('R1C_UPLOAD_PATH_INVALID');
  var folder=DriveApp.getFolderById(c.evidenceFolderId),filename=parts.pop();
  parts.forEach(function(p){var it=folder.getFoldersByName(p);if(!it.hasNext())_r1cUploadPending(1);folder=it.next();if(it.hasNext())_r1cRequestError('R1C_UPLOAD_AMBIGUOUS');});
  var files=folder.getFilesByName(filename);if(!files.hasNext())_r1cUploadPending(1);var f=files.next();if(files.hasNext()||f.isTrashed())_r1cRequestError('R1C_UPLOAD_AMBIGUOUS');
  return {drive_file_id:f.getId(),filename:f.getName(),mime_type:f.getMimeType()};
}
function _r1cResolveUpload(path,opts){
  opts=opts||{};var waits=opts.wait===false?[]:(Array.isArray(opts.waitMs)?opts.waitMs:R1C_UPLOAD_WAIT_MS);
  var sleep=typeof opts.sleep==='function'?opts.sleep:(typeof Utilities!=='undefined'&&Utilities&&typeof Utilities.sleep==='function'?function(ms){Utilities.sleep(ms);}:null);
  for(var attempt=1;;attempt++){
    try{return _r1cResolveUploadOnce(path);}
    catch(e){
      if(!e||e.code!=='R1C_UPLOAD_PENDING'||attempt>waits.length){if(e&&e.code==='R1C_UPLOAD_PENDING')e.attempts=attempt;throw e;}
      if(sleep)sleep(waits[attempt-1]);
    }
  }
}
function _r1cBuildRequest(type,row,lines,actor,resolveUpload){
  if(!row||!row.id)_r1cRequestError('R1C_REQUEST_NOT_FOUND');
  if(row.status!=='Ready')_r1cRequestError('R1C_REQUEST_NOT_READY');
  if(typeof row.command_id!=='string'||!row.command_id.trim())_r1cRequestError('R1C_COMMAND_ID_REQUIRED');
  if(typeof row.submitted_by!=='string'||row.submitted_by.trim().toLowerCase()!==actor)_r1cRequestError('R1C_ACTOR_MISMATCH');
  if(type!=='GOODS_IN_RECEIVE'&&row.command_type!==type)_r1cRequestError('R1C_COMMAND_TYPE_MISMATCH');
  var p={},r={command_id:row.command_id.trim(),command_type:type,expected_version:row.expected_version,payload:p};
  function cell(k){return _r1aReqCell(row[k]);}
  function put(k,to){var v=cell(k);if(v!==undefined)p[to||k]=v;}
  function num(k,to){var v=cell(k);if(v!==undefined){var n=Number(v);if(typeof v==='boolean'||!Number.isFinite(n))_r1cRequestError('R1C_INVALID_NUMBER');p[to||k]=n;}}
  if(type==='STOCK_QUARANTINE'){['product_id','reason','evidence_id'].forEach(function(k){put(k);});num('quantity');num('expected_balance');return r;}
  r.job_id=cell('job_id');
  if(type==='GOODS_IN_RECEIVE'){
    ['delivery_id','delivery_note_reference','discrepancy_note'].forEach(function(k){put(k);});
    var count=Number(row.line_count);if(!Number.isSafeInteger(count)||count<1||!Array.isArray(lines)||lines.length!==count)_r1cRequestError('R1C_RECEIPT_LINES_NOT_SYNCED');
    var ids={};p.lines=lines.slice().sort(function(a,b){return String(a.id).localeCompare(String(b.id));}).map(function(l){
      if(!l.id||ids[l.id]||l.request_id!==row.id)_r1cRequestError('R1C_RECEIPT_PARENT_MISMATCH');ids[l.id]=true;
      var out={order_line_id:l.order_line_id};['quantity_good','quantity_damaged','quantity_short'].forEach(function(k){var v=_r1aReqCell(l[k]);out[k]=v===undefined?0:Number(v);if(typeof v==='boolean'||!Number.isFinite(out[k]))_r1cRequestError('R1C_INVALID_NUMBER');});if(l.evidence_id)out.evidence_id=l.evidence_id;return out;
    });
    if(cell('delivery_note_path')){var ev=resolveUpload(cell('delivery_note_path'));p.delivery_note_file_id=ev.drive_file_id;p.delivery_note_filename=ev.filename;}
    return r;
  }
  r.work_package_id=cell('work_package_id');
  var spec=_r1cContracts()[type];
  spec.fields.forEach(function(k){if(['evidence','answers','expected_submission_version','status'].indexOf(k)<0)put(k);});
  if(type==='COMMISSIONING_REVIEW')put('review_status','status');
  if(type==='IW_COMMISSIONING_DRAFT'){
    num('expected_submission_version');
    if(cell('question_key')){var ans={question_key:cell('question_key')};['value_text','value_date','not_applicable_reason'].forEach(function(k){if(cell(k)!==undefined)ans[k]=cell(k);});if(cell('value_number')!==undefined){ans.value_number=Number(cell('value_number'));if(!Number.isFinite(ans.value_number))_r1cRequestError('R1C_INVALID_NUMBER');}if(cell('value_boolean')!==undefined){if(typeof row.value_boolean!=='boolean')_r1cRequestError('R1C_INVALID_BOOLEAN');ans.value_boolean=row.value_boolean;}p.answers=[ans];}
  }
  if(spec.fields.indexOf('evidence')>=0&&cell('evidence_path'))p.evidence=[resolveUpload(cell('evidence_path'))];
  return r;
}
function _r1cCommandFromRow(type,id,actorEmail,deps){
  deps=deps||{};var actor=_r1aReqEmail(actorEmail),session=typeof deps.sessionEmail==='string'?_r1aReqEmail(deps.sessionEmail):_r1aSessionEmail();
  if(!actor)_r1cRequestError('R1C_AUTHENTICATED_EMAIL_REQUIRED');if(session&&session!==actor)_r1cRequestError('R1C_ACTOR_MISMATCH');
  if(deps.sheetId&&deps.sheetId!==R1A_REQUEST_DEV_SHEET)_r1cRequestError('R1C_DEV_ONLY');
  var table=_r1cRequestTable(type);if(!table)_r1cRequestError('R1C_UNKNOWN_COMMAND');
  var rows,ss;if(deps.readRows)rows=deps.readRows(table);else{_r1cConfigGuard();ss=_r1aOpenDevRequestSpreadsheet();rows=_r1cRows(ss,table);}
  var match=rows.filter(function(r){return r.id===id;});if(match.length!==1)_r1cRequestError('R1C_REQUEST_NOT_FOUND_OR_AMBIGUOUS');var row=match[0];
  if(typeof row.submitted_by!=='string'||row.submitted_by.trim().toLowerCase()!==actor)_r1cRequestError('R1C_ACTOR_MISMATCH');
  var lines=type==='GOODS_IN_RECEIVE'?(deps.readRows?deps.readRows('DEVGoodsInRequestLines'):_r1cRows(ss,'DEVGoodsInRequestLines')).filter(function(l){return l.request_id===row.id;}):[];
  if(!deps.dispatch){var options=_r1aCloudOptions(),person=_r1aActor(options.store,actor);_r1cAccess(options.store,person,{command_type:type,job_id:row.job_id||undefined,work_package_id:row.work_package_id||undefined,payload:{delivery_id:row.delivery_id,product_id:row.product_id,submission_id:row.submission_id,reason:row.reason}},true);}
  var req=_r1cBuildRequest(type,row,lines,actor,deps.resolveUpload||_r1cResolveUpload);
  return (deps.dispatch||_r1aDispatchBuiltRequest)(req,actor);
}
/* Optional trusted USEREMAIL() argument for the new reads; never a request payload/row identity. */
function _r1cReadCloud(request,actorEmail){
  _r1cConfigGuard();var session=_r1aSessionEmail(),actor=actorEmail===undefined?session:_r1aReqEmail(actorEmail);
  if(!actor)_r1cRequestError('R1C_AUTHENTICATED_EMAIL_REQUIRED');if(session&&session!==actor)_r1cRequestError('R1C_ACTOR_MISMATCH');
  var options=_r1aCloudOptions();options.actorEmail=function(){return actor;};return _r1aCreate(options).read(request);
}
function _r1cProvision(ss,apply){
  if(ss.getId()!==R1A_REQUEST_DEV_SHEET)_r1cRequestError('R1C_DEV_ONLY');
  var plans=Object.keys(R1C_REQUEST_HEADERS).map(function(name){var matches=ss.getSheets().filter(function(sh){return sh.getName()===name;});if(matches.length>1)_r1cRequestError('R1C_REQUEST_SCHEMA');var sh=matches[0],h=sh&&sh.getLastColumn()?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]:[];if(h.some(function(k,i){return !k||h.indexOf(k)!==i;}))_r1cRequestError('R1C_REQUEST_SCHEMA');return {table:name,create:!sh,missing_columns:R1C_REQUEST_HEADERS[name].filter(function(k){return h.indexOf(k)<0;}),existing_columns:h};});
  if(apply)plans.forEach(function(p){var sh=ss.getSheets().filter(function(x){return x.getName()===p.table;})[0]||ss.insertSheet(p.table);if(p.missing_columns.length){var start=p.existing_columns.length+1,needed=start+p.missing_columns.length-1;if(sh.getMaxColumns()<needed)sh.insertColumnsAfter(sh.getMaxColumns(),needed-sh.getMaxColumns());sh.getRange(1,start,1,p.missing_columns.length).setValues([p.missing_columns]);}var headers=p.existing_columns.concat(p.missing_columns);headers.forEach(function(k,i){if(['expected_version','expected_submission_version','line_count','quantity','expected_balance','quantity_good','quantity_damaged','quantity_short','value_number','value_boolean','actual_end','value_date'].indexOf(k)<0)sh.getRange(2,i+1,sh.getMaxRows()-1,1).setNumberFormat('@');});});
  return {ok:true,applied:!!apply,tables:plans};
}
function _r1cProvisionCloud(apply){_r1cConfigGuard();var options=_r1aCloudOptions(),a=_r1aActor(options.store,options.actorEmail());if(a.roles.indexOf('Admin')<0&&a.roles.indexOf('Manager')<0)_r1cRequestError('R1C_ROLE_DENIED');return options.store.withLock(function(){return _r1cProvision(_r1aOpenDevRequestSpreadsheet(),apply);});}
function runR1CRequestProvisionCheck(){return _r1cProvisionCloud(false);}
function runR1CProvisionRequestTables(){return _r1cProvisionCloud(true);}
if(typeof module!=='undefined')module.exports={R1C_REQUEST_HEADERS:R1C_REQUEST_HEADERS,R1C_UPLOAD_WAIT_MS:R1C_UPLOAD_WAIT_MS,_r1cResolveUpload:_r1cResolveUpload,_r1cResolveUploadOnce:_r1cResolveUploadOnce,_r1cRequestTable:_r1cRequestTable,_r1cBuildRequest:_r1cBuildRequest,_r1cCommandFromRow:_r1cCommandFromRow,_r1cProvision:_r1cProvision};
