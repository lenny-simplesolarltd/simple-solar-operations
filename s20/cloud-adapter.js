/* Read-only DEV adapter. No production execution entry point exists. */
function _s20CloudStore() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (ss.getId() !== S20_DEV_SHEET_ID || !c || c.environment !== 'DEV') throw new Error('S20_REFUSED: exact DEV sheet/environment required');
  return { getSheetId:function(){return ss.getId();}, getEnvironment:function(){return 'DEV';} };
}
function _s20Result(name, fn) { try { var d=fn(); var r={test:name,pass:true,detail:d}; console.log(JSON.stringify(r)); return r; } catch(e) { var r={test:name,pass:false,detail:String(e.message||e)}; console.log(JSON.stringify(r)); return r; } }
function _s20CloudSummary() { var store=_s20CloudStore(); var operational=_s19CloudStore(); var a=_s18AcceptanceSummary(operational); var h=_s19MigrationSummary(operational,a); return _s20ReleaseSummary(store,a,h,{}); }
function runS20ReleaseDryRun() { return _s20Result('S20 dry run',function(){ var x=_s20CloudSummary(); return {environment:x.environment,simulation_only:true,external_calls:0,writes:0,production_changes:0}; }); }
function runS20ReleaseSimulation() { return _s20Result('S20 simulation',function(){ var x=_s20CloudSummary(); return {r1:x.overall_r1,r2:x.overall_r2,r3:x.overall_r3,r4:x.overall_r4,external_calls:0,writes:0,production_changes:0}; }); }
function runS20ReleaseSummary() { return _s20Result('S20 summary',function(){ return _s20CloudSummary(); }); }
