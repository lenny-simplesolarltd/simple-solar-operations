const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const core=require('../s20/release.js');

const passS18=rel=>({readiness:{[rel]:{readiness:'READY_FOR_CONTROLLED_PILOT',blocked:0,not_run:0,fail:0,blockers:[],not_run_items:[]}}});
const passS19=rel=>({handoff:{[rel]:{status:'READY_FOR_S20',acceptance:{blocked:[],not_run:[],failed:[]},migration:{blocked:[],not_run:[],failed:[]},training:{blocked:[],not_run:[],failed:[]},cutover:{blocked:[],not_run:[],failed:[]}}}});
function valid(rel) {
  const cfg={}; for(const k of core._s20RequiredConfig(rel)) cfg[k]={status:'CONFIGURED',value:'verified',evidence:'ref'};
  return {s18:passS18(rel),s19:passS19(rel),production_config:cfg,signoff:{status:'APPROVED',approver:'Ben'},backup:{status:'VERIFIED',reference:'backup-1',recovery_verified:true},pilot_scope:{job_ids:['SS-0001-0001']},fallback:{status:'APPROVED',destructive:false},creator_state:{old_creator:'legacy',new_creator:'Simple Solar',old_active:false,new_active:false,old_stopped_verified:true},release_modes:core._s20FunctionPlan().filter(x=>x.release===rel).map(x=>({function_id:x.function_id,mode:'Disabled',authorised_job_scope:'None',approved_version:'v1'}))};
}

test('S20 01: S18 BLOCKED prevents authorization',()=>{const c=valid('R1');c.s18.readiness.R1.readiness='BLOCKED';assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 02: S18 NOT_RUN prevents authorization',()=>{const c=valid('R1');c.s18.readiness.R1.not_run=1;c.s18.readiness.R1.not_run_items=['A'];assert.equal(core._s20EvaluateRelease('R1',c).authorization,'NOT_EVALUATED')});
test('S20 03: S18 FAIL prevents authorization',()=>{const c=valid('R1');c.s18.readiness.R1.fail=1;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'FAIL')});
test('S20 04: S19 BLOCKED prevents authorization',()=>{const c=valid('R1');c.s19.handoff.R1.status='BLOCKED';assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 05: S19 NOT_RUN prevents authorization',()=>{const c=valid('R1');c.s19.handoff.R1.training.not_run=['T'];assert.equal(core._s20EvaluateRelease('R1',c).authorization,'NOT_EVALUATED')});
test('S20 06: missing PROD configuration blocks',()=>{const c=valid('R1');delete c.production_config.prod_sheet_id;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 07: missing signoff blocks',()=>{const c=valid('R1');delete c.signoff;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 08: missing backup blocks',()=>{const c=valid('R1');delete c.backup;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 09: undefined pilot scope blocks',()=>{const c=valid('R1');delete c.pilot_scope;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 10: dual creator blocks',()=>{const c=valid('R1');c.creator_state.old_active=true;c.creator_state.new_active=true;assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 11: unexpected ReleaseMode blocks',()=>{const c=valid('R1');c.release_modes[0].mode='Manual';assert.equal(core._s20EvaluateRelease('R1',c).authorization,'BLOCKED')});
test('S20 12: fully prepared in-memory release authorizes',()=>assert.equal(core._s20EvaluateRelease('R1',valid('R1')).authorization,'AUTHORIZED_FOR_CUTOVER'));
test('S20 13: unrelated later-release blocker does not block R1',()=>{const c=valid('R1');c.s19.handoff.R2={status:'BLOCKED'};assert.equal(core._s20EvaluateRelease('R1',c).authorization,'AUTHORIZED_FOR_CUTOVER')});
test('S20 14: fallback is explicitly non-destructive',()=>{for(const r of core.S20_RELEASES){const f=core._s20ReleasePlan(r).fallback.join(' ').toLowerCase();assert.doesNotMatch(f,/delete|destroy|erase/)}});
test('S20 15: evaluation performs no external calls or writes',()=>{const r=core._s20EvaluateRelease('R1',valid('R1'));assert.equal(r.external_calls,0);assert.equal(r.writes,0);assert.equal(r.production_changes,0)});
test('S20 16: summary is read-only',()=>{const store={getSheetId:()=>core.S20_DEV_SHEET_ID,getEnvironment:()=> 'DEV'};const prep={R1:valid('R1'),R2:valid('R2'),R3:valid('R3'),R4:valid('R4')};const before=structuredClone(prep);const s18={readiness:{}};const s19={handoff:{}};for(const r of core.S20_RELEASES){s18.readiness[r]=prep[r].s18.readiness[r];s19.handoff[r]=prep[r].s19.handoff[r]}core._s20ReleaseSummary(store,s18,s19,prep);assert.deepEqual(prep,before)});
test('S20 17: exact DEV guard',()=>{assert.throws(()=>core._s20ReleaseSummary({getSheetId:()=> 'wrong',getEnvironment:()=> 'DEV'},{},{},{}),/S20_REFUSED/)});
test('S20 18: no callable production execution function exists',()=>{const src=fs.readFileSync('s20/release.js','utf8')+'\n'+fs.readFileSync('s20/cloud-adapter.js','utf8');assert.doesNotMatch(src,/function\s+(?:runS20GoLive|runS20DeployProd|activateProduction)\s*\(/);assert.doesNotMatch(src,/CalendarApp|UrlFetchApp|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet/)});
test('S20 19: all canonical FN-01 through FN-20 occur exactly once',()=>{const f=core._s20FunctionPlan();assert.equal(f.length,20);assert.deepEqual(f.map(x=>x.function_id).sort(),Array.from({length:20},(_,i)=>'FN-'+String(i+1).padStart(2,'0')).sort())});
test('S20 20: legacy S19 handoff is accepted through adapter',()=>{const a=core._s20AdaptS19({handoff:{R1:{handoff_readiness:'BLOCKED',s18_blockers:['A'],training_not_run:['T']}}},'R1');assert.equal(a.status,'BLOCKED');assert.deepEqual(a.acceptance.blocked,['A']);assert.deepEqual(a.training.not_run,['T'])});
test('S20 21: generated Apps Script is namespaced and parseable',()=>{const src=fs.readFileSync('apps-script/s20/S20Release.js','utf8');new vm.Script(src);for(const m of src.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm))assert.match(m[1],/^(?:S20_|_s20|runS20)/)});
