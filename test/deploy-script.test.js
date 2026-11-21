import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The deployment script's commands that ask, inspect or delete, run against a stand-in for the
// Azure CLI that records what it is asked and answers from a script. Nothing here reaches Azure,
// and the Node programs the script starts get a stand-in for `fetch`, so nothing reaches a key's
// service either.
const script = fileURLToPath(new URL('../scripts/deploy.sh', import.meta.url));
const group = 'pince-test-rg';
const posixOnly = { skip: process.platform === 'win32' && 'the deployment script needs Bash' };

const standIn = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AZ_LOG"
case "$1 $2" in
  'account show') echo 'Test subscription' ;;
  'account list')
    if [ -n "\${AZ_SUBSCRIPTIONS:-}" ]; then printf '%s\\n' "$AZ_SUBSCRIPTIONS"
    else printf 'Test subscription\\tsub-1\\ttrue\\n'; fi ;;
  'group exists') echo "\${AZ_GROUP_EXISTS:-true}" ;;
  'deployment group')
    if [ "$3" = create ]; then
      # The template's parameters arrive on standard input. Keep the library's for the test to read.
      case "$*" in
        *pince-infra*@/dev/stdin*) cat > "$AZ_LOG.parameters" ;;
        *@/dev/stdin*) cat > /dev/null ;;
      esac
      exit 0
    fi
    [ "\${AZ_HAS_LIBRARY:-yes}" = yes ] || exit 3
    case "$*" in *provisioningState*) echo "\${AZ_STATE:-Succeeded}" ;; *) echo pince-infra ;; esac ;;
  'resource list')
    case "$*" in
      *length*) echo "\${AZ_RESOURCES:-1}" ;;
      *) printf 'Name        Type\\nsite-abc    Microsoft.Web/staticSites\\n' ;;
    esac ;;
  'staticwebapp show') case "$*" in *'-o json'*) echo '{"id":"/subscriptions/test/site"}' ;; esac ;;
  'staticwebapp appsettings')
    case "$*" in *'--query properties'*) echo '{}' ;; *) echo '{"properties":{}}' ;; esac ;;
  # Publishing is exercised by deploying, not here: a deployment that gets this far stops.
  'functionapp list') echo 'The stand-in stops a deployment here.' >&2; exit 9 ;;
  'cognitiveservices account') [ "$3" = list ] && printf 'vision-abc\\tswedencentral\\nocr-abc\\twesteurope\\n' ;;
  'bicep version')
    case "\${AZ_BICEP:-ok}" in
      missing) echo 'ERROR: Bicep CLI not found. Install it now by running "az bicep install".' >&2; exit 1 ;;
      no-icu) echo "ERROR: Process terminated. Couldn't find a valid ICU package installed on the system." >&2; exit 134 ;;
      *) echo 'Bicep CLI version 0.30' ;;
    esac ;;
esac
# What a program hands over on standard input, such as a key, is kept apart from the arguments.
case "$*" in *@-*) cat >> "$AZ_LOG.stdin" ;; esac
exit 0
`;
// The other tools the script looks for. This npm "installs" only the two folders the script checks.
const tools = {
  swa: 'echo 2.1.0\n',
  zip: 'exit 0\n',
  npm: `case "$1" in
  --version) echo 10.9.0 ;;
  ci) mkdir -p "$3/node_modules/@img/sharp-linux-x64" "$3/node_modules/@img/sharp-libvips-linux-x64" ;;
esac
`,
};
// Every outside service answers with KEY_CHECK_STATUS, and the hosts asked are written down.
const fetchStandIn = `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (target) => {
  appendFileSync(process.env.AZ_LOG + '.fetch', new URL(String(target?.url ?? target)).host + '\\n');
  return new Response('{"results":[]}', { status: Number(process.env.KEY_CHECK_STATUS || 200) });
};
`;

async function run(t, mode, { env = {}, input = '' } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'pince-az-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const log = join(folder, 'calls.log');
  for (const [name, text] of Object.entries({ az: standIn, ...tools })) {
    await writeFile(join(folder, name), name === 'az' ? text : '#!/usr/bin/env bash\n' + text);
    await chmod(join(folder, name), 0o755);
  }
  await writeFile(join(folder, 'fetch.mjs'), fetchStandIn);
  await writeFile(log, '');
  const result = spawnSync('bash', [script, ...mode], {
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      PATH: folder + delimiter + process.env.PATH,
      NODE_OPTIONS: '--import=' + pathToFileURL(join(folder, 'fetch.mjs')).href,
      AZ_LOG: log,
      LIBRARY_RESOURCE_GROUP: group,
      LIBRARY_CONFIRM_DESTROY: '',
      // Nothing from the shell of whoever runs the tests answers a question for them.
      ...Object.fromEntries(
        [
          'LIBRARY_LOCATION',
          'VISION_LOCATION',
          'PARENT_USERNAME',
          'CHILD_USERNAME',
          'BOOTSTRAP_PARENT_PASSWORD',
          'BOOTSTRAP_CHILD_PASSWORD',
          'BUDGET_EMAIL',
        ].map((name) => [name, '']),
      ),
      ...env,
    },
  });
  const kept = (suffix) => readFile(log + suffix, 'utf8').catch(() => '');
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls: (await kept('')).split('\n').filter(Boolean),
    parameters: await kept('.parameters'),
    handed: await kept('.stdin'),
    fetched: (await kept('.fetch')).split('\n').filter(Boolean),
  };
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
  for (const mode of [['remove'], ['destroy', 'now'], ['status', 'all'], ['setup', 'now'], ['keys', 'all']]) {
    const result = await run(t, mode);
    assert.equal(result.status, 2, mode.join(' '));
    assert.match(result.output, /Usage:/);
    assert.deepEqual(result.calls, []);
  }
});

// The answers to setup's questions, one a line, in the order it asks them.
const lines = (...answers) => answers.join('\n') + '\n';
const parentPassword = 'a-long-password-1';
const childPassword = 'another-password-2';
const looking =
  /^(account show|account list|group exists|deployment group show|bicep version|resource list)\b/;

test(
  'setup asks again after a wrong answer and creates nothing when the last answer is no',
  posixOnly,
  async (t) => {
    const result = await run(t, ['setup'], {
      env: { AZ_GROUP_EXISTS: 'false' },
      input: lines(
        '', // the resource group offered
        'North Europe',
        'northeurope',
        'Ana',
        'ana',
        'ana',
        'copil',
        'short',
        parentPassword,
        'not-the-same-one',
        parentPassword,
        parentPassword,
        childPassword,
        childPassword,
        'maybe',
        'y',
        'not-an-address',
        'someone@example.com',
        'n',
      ),
    });
    assert.equal(result.status, 0, result.output);
    for (const said of [
      /This computer is ready to deploy/,
      /Give the region by its short name/,
      /Choose two different account names/,
      /A password needs 10 to 128 characters/,
      /The two did not match/,
      /Answer y or n/,
      /does not look like an email address/,
      /Resource group:\s+pince-test-rg, in northeurope/,
      /Accounts:\s+ana \(parent\) and copil \(child\)/,
      /Photo recognition:\s+yes, in swedencentral/,
      /Cost alerts:\s+someone@example\.com/,
      /Nothing was created/,
    ])
      assert.match(result.output, said);
    for (const call of result.calls) assert.match(call, looking);
    // A password is neither shown again nor handed to a command.
    for (const secret of [parentPassword, childPassword])
      assert(!result.output.includes(secret) && !result.calls.join('\n').includes(secret));
  },
);

test('a confirmed setup creates the library as init would, with the answers given', posixOnly, async (t) => {
  const result = await run(t, ['setup'], {
    env: { AZ_GROUP_EXISTS: 'false' },
    input: lines(
      'family-books',
      'northeurope',
      'ana',
      'copil',
      parentPassword,
      parentPassword,
      childPassword,
      childPassword,
      'yes',
      '',
      'y',
    ),
  });
  const creating = result.calls.filter((call) => /\bcreate\b/.test(call));
  assert.equal(
    creating[0],
    'group create --name family-books --location northeurope --only-show-errors -o none',
  );
  assert.match(creating[1], /^deployment group create --resource-group family-books --name pince-infra /);
  const sent = Object.fromEntries(
    Object.entries(JSON.parse(result.parameters)).map(([name, entry]) => [name, entry.value]),
  );
  assert.deepEqual(
    {
      parent: sent.parentUsername,
      child: sent.childUsername,
      parentPassword: sent.parentPassword,
      childPassword: sent.childPassword,
      location: sent.location,
      vision: sent.enableVision,
    },
    { parent: 'ana', child: 'copil', parentPassword, childPassword, location: 'northeurope', vision: true },
  );
  // The passwords travelled on standard input only.
  assert(!result.calls.join('\n').includes(parentPassword) && !result.output.includes(parentPassword));
  // The stand-in ends the deployment early, and a setup that ends early says what to do next.
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Set-up stopped before the library was ready/);
});

test(
  'setup lists several subscriptions and switches only when another one is chosen',
  posixOnly,
  async (t) => {
    const AZ_SUBSCRIPTIONS = 'Family\tsub-1\ttrue\nWork\tsub-2\tfalse';
    const rest = ['', '', '', '', parentPassword, parentPassword, childPassword, childPassword, '', '', 'n'];
    const other = await run(t, ['setup'], {
      env: { AZ_GROUP_EXISTS: 'false', AZ_SUBSCRIPTIONS },
      input: lines('7', '2', ...rest),
    });
    assert.equal(other.status, 0, other.output);
    assert.match(other.output, /1\. Family \(selected\)\n\s+2\. Work\n/);
    assert.match(other.output, /Answer with a number from 1 to 2/);
    assert.deepEqual(
      other.calls.filter((call) => !looking.test(call)),
      ['account set --subscription sub-2 --only-show-errors'],
    );
    // Every question left empty takes what was offered.
    assert.match(other.output, /Resource group:\s+pince-test-rg, in westeurope/);
    assert.match(other.output, /Accounts:\s+parinte \(parent\) and copil \(child\)/);
    assert.match(other.output, /Photo recognition:\s+no\n/);
    assert.match(other.output, /Cost alerts:\s+none/);

    const same = await run(t, ['setup'], {
      env: { AZ_GROUP_EXISTS: 'false', AZ_SUBSCRIPTIONS },
      input: lines('', ...rest),
    });
    assert.equal(same.status, 0, same.output);
    for (const call of same.calls) assert.match(call, looking);
  },
);

test(
  'setup looks at what the resource group already holds before asking anything else',
  posixOnly,
  async (t) => {
    // A finished library: nothing is created, and only the optional keys are offered.
    const existing = await run(t, ['setup'], { input: lines('', '', '') });
    assert.equal(existing.status, 0, existing.output);
    assert.match(existing.output, /A library already exists in pince-test-rg, so nothing new is created/);
    assert.match(existing.output, /Google Books: skipped[^]*Brave Search: skipped/);
    assert.doesNotMatch(existing.output, /Azure region/);
    for (const call of existing.calls) assert.match(call, looking);

    // The other cases go on to the next question, or ask for another group. The input ends there.
    for (const [env, said, goesOn] of [
      [
        { AZ_STATE: 'Failed' },
        /An earlier attempt to create a library in pince-test-rg did not finish/,
        true,
      ],
      [{ AZ_HAS_LIBRARY: 'no', AZ_RESOURCES: '0' }, /exists and is empty\. The library goes there/, true],
      [{ AZ_HAS_LIBRARY: 'no' }, /exists and holds something else\. Choose another name/, false],
    ]) {
      const result = await run(t, ['setup'], { env, input: lines('') });
      assert.match(result.output, said);
      assert.equal(/Azure region/.test(result.output), goesOn, result.output);
      // Input that ends is not an answer: the script stops, having created nothing.
      assert.equal(result.status, 1);
      assert.match(result.output, /No answer was received/);
      for (const call of result.calls) assert.match(call, looking);
    }
  },
);

test('setup stops at the first check when this computer is not ready', posixOnly, async (t) => {
  const result = await run(t, ['setup'], { env: { AZ_BICEP: 'missing' }, input: lines('', '') });
  assert.equal(result.status, 1);
  assert.match(result.output, /Bicep is not installed: az bicep install/);
  assert.match(result.output, /Fix what is listed above, then run setup again/);
  assert.doesNotMatch(result.output, /Resource group for the library/);
});

test('keys tries each key once and stores it without ever putting it in a command', posixOnly, async (t) => {
  const result = await run(t, ['keys'], { input: lines('google-key-123', 'brave-key-456') });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Google Books API access verified/);
  assert.match(result.output, /Brave image search verified/);
  assert.deepEqual(result.fetched, ['www.googleapis.com', 'api.search.brave.com']);
  // Stored on the worker, and Google's also on the site for photo review: all on standard input.
  assert.deepEqual(
    result.calls
      .filter((call) => /\b(set|put)\b/.test(call))
      .map((call) => call.split(' ').slice(0, 4).join(' ')),
    ['functionapp config appsettings set', 'rest --method put --url', 'functionapp config appsettings set'],
  );
  assert.equal(
    result.handed,
    '{"GOOGLE_BOOKS_API_KEY":"google-key-123"}' +
      '{"properties":{"GOOGLE_BOOKS_API_KEY":"google-key-123"}}' +
      '{"BRAVE_SEARCH_API_KEY":"brave-key-456"}',
  );
  for (const key of ['google-key-123', 'brave-key-456'])
    assert(!result.calls.join('\n').includes(key) && !result.output.includes(key));
});

test(
  'keys changes nothing for a key left out, a key that is refused, or a missing library',
  posixOnly,
  async (t) => {
    const changing = (calls) => calls.filter((call) => /\b(set|put|create|delete)\b/.test(call));
    const skipped = await run(t, ['keys'], { input: lines('', '') });
    assert.equal(skipped.status, 0, skipped.output);
    assert.match(
      skipped.output,
      /Google Books: skipped, nothing was changed[^]*Brave Search: skipped, nothing was changed/,
    );
    assert.deepEqual([skipped.fetched, changing(skipped.calls)], [[], []]);

    // Refused once, a second key refused too, then no more tries; Brave is left out.
    const refused = await run(t, ['keys'], {
      env: { KEY_CHECK_STATUS: '403' },
      input: lines('wrong-key', 'y', 'wrong-again', 'n', ''),
    });
    assert.equal(refused.status, 0, refused.output);
    assert.match(refused.output, /Google Books rejected this key \(HTTP 403\)[^]*Nothing was changed/);
    assert.deepEqual(refused.fetched, ['www.googleapis.com', 'www.googleapis.com']);
    assert.deepEqual([changing(refused.calls), refused.handed], [[], '']);

    const none = await run(t, ['keys'], { env: { AZ_HAS_LIBRARY: 'no' }, input: lines('google-key-123') });
    assert.equal(none.status, 1);
    assert.match(none.output, /There is no library in pince-test-rg/);
    assert.deepEqual([none.fetched, changing(none.calls)], [[], []]);
  },
);

test('scripts that hand input to the Azure CLI from Node use its own stdin form', async () => {
  // Node supplies a child's input over a socket, which Linux cannot reopen as /dev/stdin.
  const folder = fileURLToPath(new URL('../scripts/', import.meta.url));
  const names = (await readdir(folder)).filter((name) => /\.m?js$/.test(name));
  assert(names.includes('sync-review-key.mjs'));
  for (const name of names)
    assert.doesNotMatch(await readFile(join(folder, name), 'utf8'), /@\/dev\/stdin/, name);
});
