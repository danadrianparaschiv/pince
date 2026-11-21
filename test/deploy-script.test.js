import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The deployment script's commands that inspect or delete a library, run against a stand-in for
// the Azure CLI that records what it is asked and answers from a script. Nothing here reaches Azure.
const script = fileURLToPath(new URL('../scripts/deploy.sh', import.meta.url));
const group = 'pince-test-rg';
const posixOnly = { skip: process.platform === 'win32' && 'the deployment script needs Bash' };

const standIn = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AZ_LOG"
case "$1 $2" in
  'account show') echo 'Test subscription' ;;
  'group exists') echo "\${AZ_GROUP_EXISTS:-true}" ;;
  'deployment group') [ "\${AZ_HAS_LIBRARY:-yes}" = yes ] || exit 3; echo pince-infra ;;
  'resource list') printf 'Name        Type\\nsite-abc    Microsoft.Web/staticSites\\n' ;;
  'cognitiveservices account') [ "$3" = list ] && printf 'vision-abc\\tswedencentral\\nocr-abc\\twesteurope\\n' ;;
  'bicep version')
    case "\${AZ_BICEP:-ok}" in
      missing) echo 'ERROR: Bicep CLI not found. Install it now by running "az bicep install".' >&2; exit 1 ;;
      no-icu) echo "ERROR: Process terminated. Couldn't find a valid ICU package installed on the system." >&2; exit 134 ;;
      *) echo 'Bicep CLI version 0.30' ;;
    esac ;;
esac
exit 0
`;

async function run(t, mode, { env = {}, input = '' } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'pince-az-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const log = join(folder, 'calls.log');
  await writeFile(join(folder, 'az'), standIn);
  await chmod(join(folder, 'az'), 0o755);
  await writeFile(log, '');
  const result = spawnSync('bash', [script, ...mode], {
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      PATH: folder + delimiter + process.env.PATH,
      AZ_LOG: log,
      LIBRARY_RESOURCE_GROUP: group,
      LIBRARY_CONFIRM_DESTROY: '',
      ...env,
    },
  });
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  return { status: result.status, output: result.stdout + result.stderr, calls };
}
const deletes = (calls) => calls.filter((call) => /\b(delete|purge)\b/.test(call));

test(
  "destroy deletes nothing without the resource group's name typed as confirmation",
  posixOnly,
  async (t) => {
    // Not run from a terminal and no confirmation given.
    const silent = await run(t, ['destroy']);
    assert.equal(silent.status, 1);
    assert.match(silent.output, /Nothing was deleted/);
    assert.deepEqual(deletes(silent.calls), []);
    // It did say what would be lost before asking.
    assert.match(silent.output, /permanently deletes the library in pince-test-rg/);
    assert.match(silent.output, /cannot be recovered/);

    for (const wrong of ['yes', 'PINCE-TEST-RG', 'pince-test-rg ', 'pince-rg']) {
      const refused = await run(t, ['destroy'], { env: { LIBRARY_CONFIRM_DESTROY: wrong } });
      assert.equal(refused.status, 1, wrong);
      assert.match(refused.output, /did not match\. Nothing was deleted/);
      assert.deepEqual(deletes(refused.calls), [], wrong);
    }
  },
);

test('destroy refuses a resource group that is not a library, even when confirmed', posixOnly, async (t) => {
  for (const env of [{ AZ_HAS_LIBRARY: 'no' }, { AZ_GROUP_EXISTS: 'false' }]) {
    const result = await run(t, ['destroy'], { env: { ...env, LIBRARY_CONFIRM_DESTROY: group } });
    assert.equal(result.status, 1);
    assert.match(result.output, /There is no library in pince-test-rg\. Nothing was deleted/);
    assert.deepEqual(deletes(result.calls), []);
  }
});

test(
  'a confirmed destroy deletes exactly that resource group, then clears its deleted AI accounts',
  posixOnly,
  async (t) => {
    const result = await run(t, ['destroy'], { env: { LIBRARY_CONFIRM_DESTROY: group } });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /The library in pince-test-rg was deleted/);
    assert.deepEqual(deletes(result.calls), [
      'group delete --name pince-test-rg --yes --only-show-errors',
      'cognitiveservices account purge --name vision-abc --resource-group pince-test-rg --location swedencentral --only-show-errors',
      'cognitiveservices account purge --name ocr-abc --resource-group pince-test-rg --location westeurope --only-show-errors',
    ]);
    // The accounts were noted before the group, and with it the list, was gone.
    const order = (pattern) => result.calls.findIndex((call) => pattern.test(call));
    assert(order(/cognitiveservices account list/) < order(/group delete/));
  },
);

test('doctor and status only look: neither creates, changes nor deletes anything', posixOnly, async (t) => {
  const reading =
    /^(account show|group exists|deployment group show|bicep version|staticwebapp show|staticwebapp appsettings list|functionapp config appsettings list)\b/;
  const doctor = await run(t, ['doctor']);
  assert.match(doctor.output, /Signed in to Azure; subscription: Test subscription/);
  assert.match(doctor.output, /A library exists in pince-test-rg/);
  for (const call of doctor.calls) assert.match(call, reading);
  const fresh = await run(t, ['doctor'], { env: { AZ_GROUP_EXISTS: 'false' } });
  assert.match(fresh.output, /No library in pince-test-rg yet/);

  const status = await run(t, ['status']);
  assert.equal(status.status, 0, status.output);
  // Settings are reported as set or not set; the stand-in returned none.
  assert.match(status.output, /Photo recognition\s+not set/);
  for (const call of status.calls) assert.match(call, reading);
  const none = await run(t, ['status'], { env: { AZ_HAS_LIBRARY: 'no' } });
  assert.match(none.output, /There is no library in pince-test-rg/);
});

test(
  'a Bicep that cannot start is told apart from a missing one, and stops init before anything is created',
  posixOnly,
  async (t) => {
    const missing = await run(t, ['doctor'], { env: { AZ_BICEP: 'missing' } });
    assert.equal(missing.status, 1);
    assert.match(missing.output, /Bicep is not installed: az bicep install/);
    const broken = await run(t, ['doctor'], { env: { AZ_BICEP: 'no-icu' } });
    assert.equal(broken.status, 1);
    assert.match(broken.output, /Bicep is installed but cannot start: it needs the ICU library/);
    assert.doesNotMatch(broken.output, /Bicep is not installed/);

    for (const mode of [['init'], ['init', '--with-vision'], ['publish'], ['covers'], ['budgets']]) {
      const stopped = await run(t, mode, {
        env: { AZ_BICEP: 'no-icu', AZ_GROUP_EXISTS: 'false', BUDGET_EMAIL: 'someone@example.com' },
      });
      assert.equal(stopped.status, 1, mode.join(' '));
      assert.match(stopped.output, /cannot start: it needs the ICU library/);
      for (const call of stopped.calls) assert.match(call, /^(account show|bicep version)\b/, mode.join(' '));
    }
  },
);

test('an unknown command or a stray argument changes nothing and shows the usage', posixOnly, async (t) => {
  for (const mode of [['remove'], ['destroy', 'now'], ['status', 'all']]) {
    const result = await run(t, mode);
    assert.equal(result.status, 2, mode.join(' '));
    assert.match(result.output, /Usage:/);
    assert.deepEqual(result.calls, []);
  }
});

test('scripts that hand input to the Azure CLI from Node use its own stdin form', async () => {
  // Node supplies a child's input over a socket, which Linux cannot reopen as /dev/stdin.
  const folder = fileURLToPath(new URL('../scripts/', import.meta.url));
  const names = (await readdir(folder)).filter((name) => /\.m?js$/.test(name));
  assert(names.includes('sync-review-key.mjs'));
  for (const name of names)
    assert.doesNotMatch(await readFile(join(folder, name), 'utf8'), /@\/dev\/stdin/, name);
});
