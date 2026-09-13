/* Apps Script manifest drift + global safety invariants across every bundle. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { build, render } = require('../scripts/build-manifest.cjs');

test('MANIFEST 01: committed manifest matches the repository (run node scripts/build-manifest.cjs after changing bundles)', () => {
  const current = build();
  const committed = JSON.parse(fs.readFileSync('docs/generated/apps-script-manifest.json', 'utf8'));
  assert.deepEqual(committed, current, 'docs/generated/apps-script-manifest.json is stale');
  assert.equal(fs.readFileSync('docs/generated/apps-script-manifest.md', 'utf8'), render(current), 'docs/generated/apps-script-manifest.md is stale');
});

test('MANIFEST 02: external Google services appear only where authorised', () => {
  const m = build();
  const allow = {
    CalendarApp: ['apps-script/S01Probe.js', 'apps-script/calendar/CalendarSync.js'],
    DriveApp: ['apps-script/s16/S16Health.js', 'apps-script/backup/BackupService.js', 'apps-script/r1-appsheet/R1AppSheetAdapter.js'],
    UrlFetchApp: ['apps-script/s04-bridge/BridgeCore.gs'],
    MailApp: ['apps-script/S01Probe.js'],
    GmailApp: [],
    ScriptApp: ['apps-script/S01Probe.js', 'apps-script/s04-bridge/BridgeCore.gs', 'apps-script/s04/S04Core.gs']
  };
  for (const b of m.bundles) for (const s of Object.keys(allow)) if (b.services.includes(s)) assert.ok(allow[s].includes(b.file), b.file + ' uses ' + s + ' but is not on the allowlist');
  assert.deepEqual(m.standalone_bridge.services.filter(s => Object.keys(allow).includes(s)), ['DriveApp'], 'standalone bridge only reads metadata for AppSheet uploads');
  const bridge = fs.readFileSync(m.standalone_bridge.file, 'utf8');
  assert.doesNotMatch(bridge, /DriveApp\.(?:create|remove)|\.(?:setSharing|addEditor|setTrashed|moveTo)\(/, 'no Drive mutations in bridge');
  /* Every bundle that writes is locked to the DEV sheet id. */
  for (const b of m.bundles) if (b.entry_points.some(e => /^run|^appSheet/.test(e)) && !/S01Probe|S02Provisioner|S04Fixture|s04-bridge|s04\//.test(b.file)) assert.ok(b.hardcoded_dev_sheet_id, b.file + ' should carry the DEV sheet id guard');
  const cal = m.bundles.find(b => b.file === 'apps-script/calendar/CalendarSync.js');
  assert.ok(cal.hardcoded_dev_calendar_id);
  assert.ok(m.bundles.every(b => b.file !== 'apps-script/calendar/CalendarSync.js' ? true : b.config_keys.includes('calendarMode')));
});

test('MANIFEST 03: every new service bundle exposes a restore/safe-state or read-only surface and a happy path or smoke', () => {
  const m = build();
  const expect = {
    'apps-script/calendar/CalendarSync.js': ['restoreCalSafeState', 'runCalLiveDevSmoke', 'runCalStatus'],
    'apps-script/scaffold/ScaffoldWorkflow.js': ['restoreScfSafeState', 'runScfHappyPathTest'],
    'apps-script/materials/MaterialsWorkflow.js': ['restoreMatSafeState', 'runMatHappyPathTest'],
    'apps-script/resource/ResourcePlanning.js': ['runRpProvisionCheck', 'runRpHappyPathTest'],
    'apps-script/backup/BackupService.js': ['runBkStatus', 'runBkHappyPathTest'],
    'apps-script/resilience/ResilienceReview.js': ['runRsReviewQueue', 'runRsSweep'],
    'apps-script/xero/XeroAdapter.js': ['runXoRequests', 'runXoDispatch'],
    'apps-script/installer/InstallerWorkflow.js': ['restoreIwSafeState', 'runIwHappyPathTest'],
    'apps-script/s16/S16Health.js': ['runS16HeartbeatSmoke', 'restoreS16SafeState']
  };
  for (const [file, fns] of Object.entries(expect)) { const b = m.bundles.find(x => x.file === file); assert.ok(b, file); for (const fn of fns) assert.ok(b.entry_points.includes(fn), file + ' missing ' + fn); }
  const walkthrough = fs.readFileSync('docs/DEV-integration-walkthrough.md', 'utf8');
  for (const [, fns] of Object.entries(expect)) for (const fn of fns) assert.ok(walkthrough.includes(fn), 'walkthrough does not mention ' + fn);
});
