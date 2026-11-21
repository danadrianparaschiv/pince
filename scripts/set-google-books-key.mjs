// Stores a Google Books API key on the cover worker and the review API, after trying it once.
// Reads the key from stdin so it is absent from command arguments and shell history.
// Usage: ./scripts/deploy.sh keys, which asks for it without showing it.
// From a secret store: printf '%s' "$GOOGLE_KEY" | node scripts/set-google-books-key.mjs
import { execFileSync } from 'node:child_process';
import { syncReviewKey } from './sync-review-key.mjs';

const stop=message=>{ console.error(message); process.exit(1); };
const chunks=[]; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const key=Buffer.concat(chunks).toString('utf8').trim();
if(!key || /\s/.test(key) || key.length>256)stop('Supply one Google Books API key on standard input. Nothing was changed.');
const group=process.env.LIBRARY_RESOURCE_GROUP || 'pince-rg';
const az=(args,input)=>execFileSync('az',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
let worker='';
try{ worker=az(['deployment','group','show','-g',group,'-n','pince-covers','--query','properties.outputs.workerName.value','-o','tsv']).trim(); }
catch{ /* Reported just below. */ }
if(!worker)stop('The cover worker of this library was not found. Deploy it first with: ./scripts/deploy.sh covers. Nothing was changed.');
// Validate access before changing the live worker's configuration.
const response=await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:9780142410370&maxResults=1&fields=totalItems',{
  headers:{'X-Goog-Api-Key':key},redirect:'error',signal:AbortSignal.timeout(15000),
}).catch(()=>stop('Google Books did not answer. Check your connection. Nothing was changed.'));
await response.body?.cancel();
if(!response.ok)stop('Google Books rejected this key (HTTP '+response.status+'). Check that the Books API is enabled, the key\'s restrictions and its quota. Nothing was changed.');
az(['functionapp','config','appsettings','set','-g',group,'-n',worker,'--settings','@-','--only-show-errors','-o','none'],
  JSON.stringify({GOOGLE_BOOKS_API_KEY:key}));
syncReviewKey(group,key);
console.log('Google Books API access verified; key stored on the worker and review API.');
