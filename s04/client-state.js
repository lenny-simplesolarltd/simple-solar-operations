/* Transport-neutral controller for the trusted S04 command UI/bridge.
 * This is client state, not authentication. Backend authorisation is authoritative.
 * storage implements load()/save(value); it stores request/result only, never proof/secret. */
function createCompletionController({ storage, send, commandId }) {
  let state = storage.load() || { status: 'Idle', request: null, result: null };
  let inFlight = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  function save() { storage.save(copy(state)); }
  async function dispatch() {
    if (inFlight) throw new Error('SUBMISSION_IN_PROGRESS');
    if (!state.request) throw new Error('NO_COMMAND');
    inFlight = true;
    state.status = 'Pending'; save();
    try {
      const result = await send(copy(state.request)); // Transport obtains fresh actor proof server-side.
      const verifiedCommit = result && result.status === 'Committed' && result.committed === true &&
        result.command_id === state.request.command_id && result.task_id === state.request.task_id &&
        result.version === state.request.expected_version + 1 && typeof result.commit_id === 'string' && result.commit_id.length > 0;
      if (verifiedCommit) state = { ...state, status: 'Committed', result };
      else if (result && result.status === 'Failed') state = { ...state, status: 'Failed', result };
      else state = { ...state, status: 'Pending', result: result || { error: 'RESULT_UNCONFIRMED' } };
    } catch (_) {
      state.result = { error: 'CONNECTION_UNCERTAIN_RETRY_SAME_COMMAND' };
    } finally {
      inFlight = false; save();
    }
    return copy(state);
  }
  return {
    getState: () => copy(state),
    canHideTask: () => state.status === 'Committed',
    async complete(taskId, version, note) {
      if (state.request) throw new Error('COMMAND_ALREADY_EXISTS');
      state.request = { command_id: commandId(), action: 'COMPLETE_TASK', task_id: taskId,
        expected_version: version, payload: { completion_note: note } };
      save(); return dispatch();
    },
    retry: () => state.status === 'Committed' ? Promise.resolve(copy(state)) : dispatch()
  };
}
if (typeof module !== 'undefined') module.exports = { createCompletionController };
