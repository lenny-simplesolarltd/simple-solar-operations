/* S03 processor — command validation, idempotency, and replay protection.
 * Authority: 01 §3 command processing, concurrency, and partial failure. */

const { simpleHash } = require('./types.js');

function validateCommandEnvelope(command) {
  if (!command || typeof command !== 'object') return { valid: false, reason: 'command must be an object' };
  if (!command.command_id || typeof command.command_id !== 'string') return { valid: false, reason: 'command_id required' };
  if (!command.command_type || typeof command.command_type !== 'string') return { valid: false, reason: 'command_type required' };
  if (!command.entity_id || typeof command.entity_id !== 'string') return { valid: false, reason: 'entity_id required' };
  if (!command.submitted_at) return { valid: false, reason: 'submitted_at required' };
  if (!command.payload_hash) return { valid: false, reason: 'payload_hash required' };
  if (!command.actor_email || typeof command.actor_email !== 'string') return { valid: false, reason: 'actor_email required' };
  if (!Array.isArray(command.actor_roles)) return { valid: false, reason: 'actor_roles must be an array' };
  return { valid: true };
}

function checkIdempotency(command, processedCommands) {
  const existing = processedCommands.get(command.command_id);
  if (!existing) return { duplicate: false };

  if (existing.payload_hash === command.payload_hash) {
    return { duplicate: true, replay: true, originalResult: existing.result };
  }

  return { duplicate: true, replay: false, reason: 'same command_id, different content' };
}

function recordProcessedCommand(command, result, processedCommands) {
  processedCommands.set(command.command_id, {
    command_id: command.command_id,
    payload_hash: command.payload_hash,
    result: JSON.parse(JSON.stringify(result)),
    processed_at: new Date().toISOString()
  });
}

function validatePayload(command, schema) {
  if (!schema || !schema.commands) return { valid: true };
  const cmdSchema = schema.commands[command.command_type];
  if (!cmdSchema) return { valid: false, reason: 'unknown command_type: ' + command.command_type };

  const payload = command.payload || {};
  for (const [field, rules] of Object.entries(cmdSchema)) {
    if (rules.required && (payload[field] === undefined || payload[field] === null)) {
      return { valid: false, reason: 'missing required field: ' + field };
    }
    if (rules.type && payload[field] !== undefined && payload[field] !== null) {
      if (rules.type === 'string' && typeof payload[field] !== 'string')
        return { valid: false, reason: field + ' must be string' };
      if (rules.type === 'number' && typeof payload[field] !== 'number')
        return { valid: false, reason: field + ' must be number' };
      if (rules.type === 'boolean' && typeof payload[field] !== 'boolean')
        return { valid: false, reason: field + ' must be boolean' };
    }
  }
  return { valid: true };
}

if (typeof module !== 'undefined') {
  module.exports = { validateCommandEnvelope, checkIdempotency, recordProcessedCommand, validatePayload };
}
