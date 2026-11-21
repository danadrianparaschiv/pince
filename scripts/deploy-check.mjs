import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const [origin, release] = process.argv.slice(2);
const get = (path, options = {}) => fetch(new URL(path, origin), {
  ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000)
});

async function probe() {
  const published = await get('/release.json?release=' + release);
  assert.equal((await published.json()).release, release, 'Previous deployment still being served');
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<html/i);
  const guest = await get('/api/me');
  assert.equal(guest.status, 200);
  assert.equal((await guest.json()).user, null);
  const privateCatalog = await get('/api/books');
  assert.equal(privateCatalog.status, 401);
  const unusedJob = await get('/api/cover-jobs/' + randomUUID() + '/claim', {
    method: 'POST', headers: { 'x-library-cover-token': randomUUID() },
  });
  assert.equal(unusedJob.status, 200, 'Azure must forward the worker credential header');
  assert.deepEqual(await unusedJob.json(), { state: 'done' });
}

let lastError;
for (let attempt = 0; attempt < 18; attempt++) {
  try {
    await probe();
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 17) await delay(5000);
  }
}
if (lastError) throw new Error('Azure has not confirmed the new release and its API. Check the deployment in Static Web Apps.', { cause: lastError });

const password = process.env.BOOTSTRAP_PARENT_PASSWORD;
if (password) {
  const auth = await get('/api/login', {method:'POST',headers:{'content-type':'application/json',origin},
    body:JSON.stringify({username:process.env.PARENT_USERNAME || 'parinte',password})});
  if (auth.status !== 200) throw new Error('The deployed API rejected the parent sign-in. For a redeployment use the current parent credentials or publish.');
  const cookie = auth.headers.getSetCookie().map(s => s.split(';',1)[0]).find(c => c.startsWith('library_session='));
  assert.ok(cookie, 'The deployed login did not set the session cookie');
  try {
    const session = await get('/api/me',{headers:{cookie}});
    assert.equal((await session.json()).user?.role,'parent','Azure did not forward the session cookie to the API');
  } finally {
    const signout = await get('/api/logout',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'});
    assert.ok(signout.ok, 'The smoke-test session did not sign out');
  }
}
console.log('Verified the published release and protected API' + (password ? ', including a parent session.' : '.'));
