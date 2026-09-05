/* S03 processor — actor authentication and role resolution.
 * Authority: 01 §3 authentication and privacy. */

const { ActorRole } = require('./types.js');

const DEFAULT_PERMISSIONS = {
  [ActorRole.ADMIN]: { '*': { '*': true } },
  [ActorRole.OFFICE]: {
    Job: {
      COMPLETE_TASK: true, RECORD_CALL: true, RAISE_ISSUE: true,
      MOVE_JOB: true, CHANGE_INSTALLER: true, CANCEL_JOB: true,
      APPROVE_OPERATIONAL_COMPLETE: true, CREATE_ORDER: true,
      SEND_COMMUNICATION: true, PROCESS_INTAKE: true, RECONCILE: true,
      HEALTH_CHECK: true
    },
    Tasks: { COMPLETE_TASK: true, REOPEN: true }
  },
  [ActorRole.INSTALLER]: {
    Job: { SUBMIT_COMMISSIONING: true },
    Commissioning: { SUBMIT_COMMISSIONING: true }
  },
  [ActorRole.SCAFFOLDER]: {
    ScaffoldBookings: { VIEW_OWN_COMPANY: true }
  },
  [ActorRole.STORE]: {
    Job: { RECEIVE_DELIVERY: true, STOCK_MOVEMENT: true },
    StockMovements: { RECEIVE_DELIVERY: true, STOCK_MOVEMENT: true }
  },
  [ActorRole.FINANCE]: {
    Reports: { VIEW: true }
  }
};

function resolveActor(email, peopleDirectory) {
  const person = peopleDirectory.find(p =>
    p.email && p.email.toLowerCase() === email.toLowerCase()
  );
  if (!person) return { authenticated: false, reason: 'unknown actor: ' + email };

  const roles = [];
  if (person.role) roles.push(person.role);
  if (person.additionalRoles) roles.push(...person.additionalRoles);

  return {
    authenticated: true,
    person_id: person.id,
    email: person.email,
    roles,
    active: person.active !== false
  };
}

function actorCanPerform(actor, entityType, action, entityScope) {
  if (!actor.authenticated) return { allowed: false, reason: 'not authenticated' };
  if (!actor.active) return { allowed: false, reason: 'actor deactivated' };

  // Admin can do anything
  if (actor.roles.includes(ActorRole.ADMIN)) return { allowed: true };

  // Check role-based permissions
  for (const role of actor.roles) {
    const rolePerms = DEFAULT_PERMISSIONS[role];
    if (!rolePerms) continue;

    // Check wildcard for role
    if (rolePerms['*'] && rolePerms['*']['*']) return { allowed: true };

    // Check entity permissions
    const entityPerms = rolePerms[entityType];
    if (!entityPerms) continue;

    // Check specific action
    if (entityPerms[action]) return { allowed: true };

    // Check scoped actions
    if (entityScope === 'ASSIGNED' && entityPerms.VIEW_ASSIGNED && action === 'VIEW') return { allowed: true };
    if (entityScope === 'OWN_COMPANY' && entityPerms.VIEW_OWN_COMPANY && action === 'VIEW') return { allowed: true };
  }

  return { allowed: false, reason: 'actor ' + actor.email + ' cannot ' + action + ' on ' + entityType };
}

if (typeof module !== 'undefined') {
  module.exports = { resolveActor, actorCanPerform, DEFAULT_PERMISSIONS };
}
