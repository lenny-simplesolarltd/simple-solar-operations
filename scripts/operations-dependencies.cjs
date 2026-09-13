const fs = require('node:fs');
function operationsDependencies() {
  const src = fs.readFileSync('s12/commissioning.js','utf8');
  const start = src.indexOf('function reviewSubmission('), end = src.indexOf('function recordEquipment(', start);
  if (start < 0 || end < 0) throw new Error('S12 review source not found');
  return '/* Canonical S12 review delegate, generated from s12/commissioning.js. */\n' + src.slice(start,end).replace('function reviewSubmission(', 'function _r1cS12ReviewSubmission(');
}
module.exports = { operationsDependencies };
