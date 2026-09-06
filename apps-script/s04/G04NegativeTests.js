/* G04 negative tests — Apps Script entry points for the S04 BACKEND project.
 * Deploy alongside S04Core.gs and S04Entry.gs.
 * Uses S04_CONFIG and S04_IDENTITY_SECRET from Script Properties.
 * All sheet access via SpreadsheetApp.openById (standalone project).
 * Zero-arg functions: runG04DisabledModeTest, runG04StaleVersionTest,
 *   runG04DuplicateReplayTest, runG04CommandMismatchTest,
 *   runG04OutOfPilotTest, restoreG04SafeState, validateG04NegativeEvidence.
 * FN-01 defaults Disabled; each test manages its own enable/disable.
 * No outbound calls. No PROD access. */

function _g04LoadServices() {
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('S04_CONFIG') || 'null');
  var secret = props.getProperty('S04_IDENTITY_SECRET') || '';

  if (!config || config.environment !== 'DEV') {
    throw new Error('G04_REFUSED: S04_CONFIG.environment must be DEV');
  }
  if (config.sheetId !== '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc') {
    throw new Error('G04_REFUSED: wrong DEV sheet ID');
  }
  if (!secret || secret.length < 32) {
    throw new Error('G04_REFUSED: S04_IDENTITY_SECRET missing or too short');
  }

  var ss = SpreadsheetApp.openById(config.sheetId);
  var schemaColumns = {
    Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
    Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
    TaskEvents: ['id','task_id','action','old_status','new_status','old_owner','new_owner','old_due','new_due','reason','actor','timestamp','created_at','commit_id'],
    AuditEvents: ['id','entity_type','entity_id','action','before_json','after_json','initiating_actor','executing_service','timestamp','correlation_id','reason','commit_id','created_at'],
    CommitJournal: ['id','commit_id','state','command_id','entity_type','entity_id','expected_version','changes_json','prepared_at','committed_at','created_at'],
    ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id']
  };

  function _findSheet(name) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName() === name) return sheets[i];
    }
    return null;
  }

  function _readTable(name) {
    var sheet = _findSheet(name);
    if (!sheet) return [];
    var headers = schemaColumns[name];
    if (!headers) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol === 0) return [];
    var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    var values = range.getValues();
    var results = [];
    for (var r = 0; r < values.length; r++) {
      var record = {};
      for (var c = 0; c < headers.length && c < values[r].length; c++) {
        var v = values[r][c];
        if (v === '' || v === undefined || v === null) v = null;
        record[headers[c]] = v;
      }
      results.push(record);
    }
    return results;
  }

  function _insertRow(name, rowData) {
    var sheet = _findSheet(name);
    if (!sheet) throw new Error('Tab not found: ' + name);
    var headers = schemaColumns[name];
    var lastRow = sheet.getLastRow();
    var targetRow = lastRow + 1;
    if (targetRow > sheet.getMaxRows()) throw new Error('ROW_CAPACITY_REQUIRED: ' + name);
    var values = headers.map(function(h) {
      var v = rowData[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && /^[=']/.test(v)) return "'" + v;
      return v;
    });
    sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
    SpreadsheetApp.flush();
  }

  function _updateRow(name, id, patch) {
    var sheet = _findSheet(name);
    if (!sheet) throw new Error('Tab not found: ' + name);
    var headers = schemaColumns[name];
    var rows = _readTable(name);
    var rowIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { rowIdx = i + 2; break; }
    }
    if (rowIdx < 0) throw new Error('Row not found: ' + name + ' ' + id);
    var currentRange = sheet.getRange(rowIdx, 1, 1, headers.length);
    var currentValues = currentRange.getValues()[0];
    for (var key in patch) {
      if (!patch.hasOwnProperty(key)) continue;
      var idx = headers.indexOf(key);
      if (idx >= 0) {
        var v = patch[key];
        if (typeof v === 'string' && /^[=']/.test(v)) v = "'" + v;
        currentValues[idx] = v !== null && v !== undefined ? v : '';
      }
    }
    sheet.getRange(rowIdx, 1, 1, currentValues.length).setValues([currentValues]);
    SpreadsheetApp.flush();
  }

  var store = {
    getSheetId: function() { return ss.getId(); },
    list: _readTable,
    get: function(name, id) { return _readTable(name).filter(function(r) { return r.id === id; })[0] || null; },
    insert: function(name, data) { _insertRow(name, data); },
    update: function(name, id, patch) { _updateRow(name, id, patch); }
  };

  var u = Utilities;
  var hex = function(bytes) {
    return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  };

  function signProof(command) {
    var validated = S04.commandRequest(command);
    var requestHash = hex(u.computeDigest(u.DigestAlgorithm.SHA_256, S04.canonical(validated), u.Charset.UTF_8));
    var now = Date.now();
    var proof = {
      version: 'S04-IDENTITY-2', purpose: 'S04_COMPLETE_TASK',
      subject: 'lenny@simplesolarltd.co.uk', jti: u.getUuid(),
      email: 'lenny@simplesolarltd.co.uk',
      audience: 'S04:' + config.projectId + ':' + config.sheetId,
      issued_at: now, expires_at: now + 120000, request_hash: requestHash
    };
    proof.signature = hex(u.computeHmacSha256Signature(S04.canonical(proof), secret, u.Charset.UTF_8));
    return proof;
  }

  function runCommand(command, proof) {
    return runS04CompleteTaskCommand(JSON.stringify(command), JSON.stringify(proof));
  }

  return {
    store: store, config: config, secret: secret,
    signProof: signProof, runCommand: runCommand,
    now: function() { return Date.now(); },
    sha256: function(text) { return hex(u.computeDigest(u.DigestAlgorithm.SHA_256, text, u.Charset.UTF_8)); },
    hmac: function(text, key) { return hex(u.computeHmacSha256Signature(text, key, u.Charset.UTF_8)); },
    canonical: S04.canonical, commandRequest: S04.commandRequest
  };
}

/* --- Test runners --- */

function runG04DisabledModeTest() {
  var svc = _g04LoadServices();
  var result = G04Tests.testDisabledMode(svc);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runG04StaleVersionTest() {
  var svc = _g04LoadServices();
  var result = G04Tests.testStaleVersion(svc);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runG04DuplicateReplayTest() {
  var svc = _g04LoadServices();
  var result = G04Tests.testDuplicateReplay(svc);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runG04CommandMismatchTest() {
  var svc = _g04LoadServices();
  var result = G04Tests.testCommandMismatch(svc);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runG04OutOfPilotTest() {
  var svc = _g04LoadServices();
  var result = G04Tests.testOutOfPilot(svc);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function restoreG04SafeState() {
  var svc = _g04LoadServices();
  var result = G04Tests.restoreSafeState(svc.store);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function validateG04NegativeEvidence() {
  var svc = _g04LoadServices();
  var store = svc.store;
  var tests = [
    runG04DisabledModeTest(),
    runG04StaleVersionTest(),
    runG04DuplicateReplayTest(),
    runG04CommandMismatchTest(),
    runG04OutOfPilotTest()
  ];
  var passed = tests.filter(function(t) { return t.pass; }).length;
  var summary = { tests_run: tests.length, tests_passed: passed, tests_failed: tests.length - passed, results: tests };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
