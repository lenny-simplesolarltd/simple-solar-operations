/* Header-checked enumeration adapter; shared ScriptLock for every S15 mutation. */
function _s15CloudGuard(){
 const ss=SpreadsheetApp.getActiveSpreadsheet(),c=JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG')||'null');
 if(ss.getId()!==S15_DEV_SHEET_ID||!c||c.environment!=='DEV')throw new Error('S15_REFUSED: exact DEV sheet/environment required');
 return ss;
}
function _s15Sheet(ss,name){
 const matches=ss.getSheets().filter(s=>s.getName()===name);
 if(matches.length!==1)throw new Error('S15_SCHEMA: missing/duplicate tab '+name);
 const sh=matches[0],headers=S15_HEADERS[name];
 if(!headers||sh.getLastColumn()!==headers.length||JSON.stringify(sh.getRange(1,1,1,headers.length).getValues()[0])!==JSON.stringify(headers))throw new Error('S15_SCHEMA: header mismatch '+name);
 return sh;
}
function _s15Cell(value){return value===null||value===undefined?'':typeof value==='string'&&/^[=+@'\-]/.test(value)?"'"+value:value;}
function _s15CloudStore(){
 const ss=_s15CloudGuard();
 function list(name){const sh=_s15Sheet(ss,name),h=S15_HEADERS[name];if(sh.getLastRow()<2)return[];return sh.getRange(2,1,sh.getLastRow()-1,h.length).getValues().map(row=>{const x={};h.forEach((k,i)=>x[k]=row[i]===''?null:row[i]);return x;}).filter(r=>r.id);}
 return {
  getSheetId:function(){return ss.getId();},getEnvironment:function(){_s15CloudGuard();return'DEV';},list,
  get:function(name,id){const rows=list(name).filter(r=>r.id===id);if(rows.length>1)throw new Error('S15_SCHEMA: duplicate ID '+id);return rows[0]||null;},
  insert:function(name,row){const sh=_s15Sheet(ss,name),h=S15_HEADERS[name];if(list(name).some(r=>r.id===row.id))throw new Error('S15_SCHEMA: duplicate insert '+row.id);if(sh.getLastRow()>=sh.getMaxRows())throw new Error('S15_CAPACITY: '+name);for(const k of Object.keys(row))if(!h.includes(k))throw new Error('S15_SCHEMA: unknown field '+name+'.'+k);sh.getRange(sh.getLastRow()+1,1,1,h.length).setValues([h.map(k=>_s15Cell(row[k]))]);SpreadsheetApp.flush();},
  update:function(name,id,patch){const sh=_s15Sheet(ss,name),h=S15_HEADERS[name],values=sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),h.length).getValues(),indices=[];values.forEach((r,i)=>{if(r[0]===id)indices.push(i);});if(indices.length!==1)throw new Error('S15_SCHEMA: update row '+id);const idx=indices[0],row=values[idx];for(const k of Object.keys(patch)){if(!h.includes(k))throw new Error('S15_SCHEMA: unknown field '+name+'.'+k);row[h.indexOf(k)]=patch[k];}sh.getRange(idx+2,1,1,h.length).setValues([row.map(_s15Cell)]);SpreadsheetApp.flush();},
  withLock:function(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('S15_BUSY');try{return fn();}finally{lock.releaseLock();}}
 };
}
function _s15Result(name,fn){try{const result=fn(),r={test:name,pass:result.pass===undefined?result.ok!==false:result.pass,detail:result.detail||result};console.log(JSON.stringify(r));return r;}catch(e){const r={test:name,pass:false,detail:String(e.message||e)};console.log(JSON.stringify(r));return r;}}
function restoreS15SafeState(){return _s15Result('S15 restore',function(){return _s15SetModes(_s15CloudStore(),false);});}
function runS15FixtureDryRun(){return _s15Result('S15 dry run',function(){const s=_s15CloudStore();for(const n of Object.keys(S15_HEADERS))s.list(n);_s15ModesSnapshot(s);return{ok:true,existing_job:!!s.get('Jobs','J-s15-clean')};});}
function runS15FixtureApply(){return _s15Result('S15 fixture apply',function(){const s=_s15CloudStore();return s.withLock(function(){_s15Seed(s);return{ok:true};});});}
function runS15FixtureValidate(){return _s15Result('S15 fixture validate',function(){const s=_s15CloudStore(),rows=_s15FixtureRows();for(const t of Object.keys(rows))for(const r of rows[t]){const row=s.get(t,r.id);if(!row||row.created_by!=='S15')throw new Error('S15_FIXTURE: '+r.id);}return{ok:true};});}
function runS15EnableFunctionsForSyntheticTest(){return _s15Result('S15 enable',function(){return _s15SetModes(_s15CloudStore(),true);});}
function runS15HappyPathTest(){return _s15Result('S15 happy path',function(){return _s15Smoke(_s15CloudStore(),_s15Execute);});}
