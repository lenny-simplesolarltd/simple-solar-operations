#!/usr/bin/env node
/* Regenerate embedded Apps Script schema/seed data files from canonical JSON.
 * Run: node schema/generate-embedded.js
 * This ensures apps-script/S02SchemaData.js and S02SeedData.js
 * stay in sync with schema/tables.json and schema/config-seed.json.
 */

const fs = require('fs');

function generate() {
  const schema = JSON.parse(fs.readFileSync('schema/tables.json', 'utf8'));
  const configSeed = JSON.parse(fs.readFileSync('schema/config-seed.json', 'utf8'));

  // Generate S02SchemaData.js
  const schemaJson = JSON.stringify(schema);
  const schemaLines = [
    '/* S02 schema data — generated from schema/tables.json.',
    ' * Do not edit manually. Regenerate with: node schema/generate-embedded.js',
    ' * Repository schema/tables.json is the authoritative source.',
    ' */',
    '',
    'var S02_SCHEMA_VERSION = ' + JSON.stringify(schema.schema_version) + ';',
    '',
    'function getS02SchemaDefinition() {',
    '  return ' + schemaJson + ';',
    '}',
    '',
    '// Table count: ' + schema.tables.length,
    '// Schema version: ' + schema.schema_version,
    ''
  ];
  fs.writeFileSync('apps-script/S02SchemaData.js', schemaLines.join('\n'));

  // Generate S02SeedData.js
  const seedJson = JSON.stringify(configSeed);
  const seedLines = [
    '/* S02 config seed data — generated from schema/config-seed.json.',
    ' * Do not edit manually. Regenerate with: node schema/generate-embedded.js',
    ' */',
    '',
    'function getS02ConfigSeed() {',
    '  return ' + seedJson + ';',
    '}',
    '',
    '// Config version: ' + configSeed.config_version,
    ''
  ];
  fs.writeFileSync('apps-script/S02SeedData.js', seedLines.join('\n'));

  console.log('Generated:');
  console.log('  apps-script/S02SchemaData.js —', schema.tables.length, 'tables,', Buffer.byteLength(schemaJson).toLocaleString(), 'bytes');
  console.log('  apps-script/S02SeedData.js   —', Buffer.byteLength(seedJson).toLocaleString(), 'bytes');
  console.log('');
  console.log('Run "node --test tests/drift.test.cjs" to verify.');
}

generate();
