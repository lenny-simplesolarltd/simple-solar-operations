/* Task due-window classification for AppSheet-ready presentation.
 * Text class is authoritative; colour/icon are presentation only. */

'use strict';

function _prioLocalDate(value, asOf) {
  if (!value) return null;
  const text = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function _prioToday(asOf) {
  if (asOf) return _prioLocalDate(asOf) || String(asOf).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function _prioAddDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Returns one of: OVERDUE | DUE_TODAY | DUE_TOMORROW | NEXT_7_DAYS | NORMAL_LATER | NO_DUE */
function classifyTaskDue(task, asOf) {
  const today = _prioToday(asOf);
  const due = _prioLocalDate(task && task.due_at, asOf);
  if (!due) return { class: 'NO_DUE', label: 'No due date', days_delta: null, due_at: null, as_of: today };
  if (due < today) {
    const late = Math.round((new Date(today + 'T12:00:00Z') - new Date(due + 'T12:00:00Z')) / 86400000);
    return { class: 'OVERDUE', label: 'OVERDUE (' + late + ' day' + (late === 1 ? '' : 's') + ' late)', days_delta: -late, due_at: due, as_of: today };
  }
  if (due === today) return { class: 'DUE_TODAY', label: 'DUE TODAY', days_delta: 0, due_at: due, as_of: today };
  if (due === _prioAddDays(today, 1)) return { class: 'DUE_TOMORROW', label: 'DUE TOMORROW', days_delta: 1, due_at: due, as_of: today };
  const weekEnd = _prioAddDays(today, 7);
  if (due <= weekEnd) {
    const delta = Math.round((new Date(due + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
    return { class: 'NEXT_7_DAYS', label: 'NEXT 7 DAYS', days_delta: delta, due_at: due, as_of: today };
  }
  const delta = Math.round((new Date(due + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
  return { class: 'NORMAL_LATER', label: 'NORMAL/LATER', days_delta: delta, due_at: due, as_of: today };
}

function enrichTaskPriority(task, asOf) {
  const dueClass = classifyTaskDue(task, asOf);
  return Object.assign({}, task, {
    due_class: dueClass.class,
    due_class_label: dueClass.label,
    days_delta: dueClass.days_delta
  });
}

/* AppSheet Format Rule expressions (paste into AppSheet; do not use colour alone). */
const APPSHEET_DUE_FORMAT_RULES = [
  { name: 'Tasks — OVERDUE', expression: 'AND(ISNOTBLANK([due_at]), DATE([due_at]) < TODAY())', text_prefix: 'OVERDUE — ', colour: '#B71C1C', icon: 'warning' },
  { name: 'Tasks — DUE TODAY', expression: 'AND(ISNOTBLANK([due_at]), DATE([due_at]) = TODAY())', text_prefix: 'DUE TODAY — ', colour: '#E65100', icon: 'today' },
  { name: 'Tasks — DUE TOMORROW', expression: 'AND(ISNOTBLANK([due_at]), DATE([due_at]) = TODAY()+1)', text_prefix: 'DUE TOMORROW — ', colour: '#F9A825', icon: 'schedule' },
  { name: 'Tasks — NEXT 7 DAYS', expression: 'AND(ISNOTBLANK([due_at]), DATE([due_at]) > TODAY()+1, DATE([due_at]) <= TODAY()+7)', text_prefix: 'NEXT 7 DAYS — ', colour: '#1565C0', icon: 'event' },
  { name: 'Tasks — NORMAL/LATER', expression: 'OR(ISBLANK([due_at]), DATE([due_at]) > TODAY()+7)', text_prefix: 'LATER — ', colour: '#546E7A', icon: 'low_priority' }
];

if (typeof module !== 'undefined') {
  module.exports = { classifyTaskDue, enrichTaskPriority, APPSHEET_DUE_FORMAT_RULES };
}
