import { change } from '../api/src/store.js';
import { runCoverJob } from '../api/src/cover-jobs.js';
// Persistent local queue, matching Azure's at-least-once delivery.
// `env` is the library's live settings, so a key saved from the app is used by the next lookup.
export function startLocalCovers(store, env = process.env) {
  store.enqueueCover = async (job, seconds = 0) => {
    await change(store,'cover-queue',job.token,() => ({...job,at:Date.now()+seconds*1000,done:false}));
  };
  let working = false;
  const tick = async () => {
    if (working) return;
    working = true;
    try {
      for (const job of await store.list('cover-queue')) {
        if(job.done || job.at > Date.now()) continue;
        const claimed = await change(store,'cover-queue',job.token,s => ({...s,at:Date.now()+240000}));
        try {
          const outcome = await runCoverJob(store,job,{env});
          if (outcome.state === 'waiting') break;
          await change(store,'cover-queue',job.token,s => s.at === claimed.at ? {...s,done:true} : s);
        }
        catch { await store.enqueueCover(job,60); }
        break;
      }
    } finally { working = false; }
  };
  const timer=setInterval(() => {void tick().catch(()=>{});},1500);
  timer.unref();
}
