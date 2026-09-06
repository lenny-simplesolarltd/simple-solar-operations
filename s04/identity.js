/* Trusted issuer must authenticate the initiating Google user independently.
 * This module verifies its HMAC assertion, never an editable actor field.
 * Secrets belong only to the issuer and the isolated DEV backend. */
const { canonical } = require('./processor.js');
function createSignedActorProvider(options) {
  return { getIdentity(request) {
    const p = options.proof;
    const fail = () => { const e = new Error('TRUSTED_IDENTITY_REQUIRED'); e.code = e.message; throw e; };
    if (!options.secret || options.secret.length < 32 || !p || p.version !== 'S04-IDENTITY-2' || p.purpose !== 'S04_COMPLETE_TASK' ||
        p.subject !== p.email || typeof p.jti !== 'string' || !/^[A-Za-z0-9_-]{16,120}$/.test(p.jti) ||
        typeof p.email !== 'string' || !p.email.trim() || p.audience !== options.audience ||
        !Number.isSafeInteger(p.issued_at) || !Number.isSafeInteger(p.expires_at) ||
        p.expires_at <= p.issued_at || p.expires_at - p.issued_at > 300000 ||
        p.issued_at > options.now() + 30000 || p.expires_at <= options.now() ||
        p.request_hash !== options.sha256(canonical(request))) fail();
    const message = canonical({ version: p.version, purpose: p.purpose, subject: p.subject, jti: p.jti, email: p.email, audience: p.audience,
      issued_at: p.issued_at, expires_at: p.expires_at, request_hash: p.request_hash });
    const expected = options.hmac(message, options.secret);
    if (typeof p.signature !== 'string' || p.signature.length !== expected.length) fail();
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ p.signature.charCodeAt(i);
    if (mismatch) fail();
    return { email: p.email, subject: p.subject, jti: p.jti };
  } };
}
module.exports = { createSignedActorProvider };
