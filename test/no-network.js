// Loaded before every test file (see the `test` script in package.json).
// The suite must run offline and cost nothing. A test that reaches for the network by accident
// fails here with a clear message, and the run fails even if the code under test swallowed that
// error as "service unavailable". Tests pass their own stand-ins, or mock `fetch` for one test.
const attempts = [];
globalThis.fetch = async (target) => {
  let host = 'an unknown host';
  try {
    host = new URL(String(target?.url ?? target)).host;
  } catch {
    /* Keep the default. */
  }
  attempts.push(host);
  throw new Error('Tests must not use the network (fetch to ' + host + '). Pass a stand-in instead.');
};
process.on('exit', () => {
  if (!attempts.length) return;
  console.error('Network use attempted during tests: ' + [...new Set(attempts)].join(', '));
  process.exitCode = 1;
});
