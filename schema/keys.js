/* S02 key generation. SS-XXXX-XXXX with collision retry.
 * Immutable text IDs, never row numbers. */

function randomHex(length) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function generateJobId(existingSet) {
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const id = 'SS-' + randomHex(4) + '-' + randomHex(4);
    if (!existingSet || !existingSet.has(id)) return id;
  }
  throw new Error('JOB_ID_COLLISION: could not generate unique SS-XXXX-XXXX after ' + maxAttempts + ' attempts');
}

function generateId(prefix) {
  const ts = Date.now().toString(36);
  const rand = randomHex(8);
  return (prefix || 'ID') + '-' + ts + '-' + rand;
}

if (typeof module !== 'undefined') module.exports = { generateJobId, generateId, randomHex };
