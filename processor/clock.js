/* S03 processor — clock abstraction.
 * Real clock for production; test clock for deterministic testing. */

function realClock() {
  return {
    now: () => new Date(),
    nowISO: () => new Date().toISOString(),
    timestamp: () => Date.now(),
    todayDate: () => {
      const d = new Date();
      return d.toISOString().slice(0, 10);
    }
  };
}

function testClock(isoStart) {
  let current = new Date(isoStart || '2026-10-23T09:00:00.000Z');
  return {
    now: () => new Date(current.getTime()),
    nowISO: () => current.toISOString(),
    timestamp: () => current.getTime(),
    todayDate: () => current.toISOString().slice(0, 10),
    advance: (ms) => { current = new Date(current.getTime() + ms); },
    advanceDays: (days) => { current = new Date(current.getTime() + days * 86400000); },
    setTo: (iso) => { current = new Date(iso); },
    get: () => new Date(current.getTime())
  };
}

if (typeof module !== 'undefined') {
  module.exports = { realClock, testClock };
}
