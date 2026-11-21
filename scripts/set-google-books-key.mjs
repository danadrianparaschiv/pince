// Reads the key from stdin so it is absent from command arguments and shell history.
// Usage: read -rs GOOGLE_KEY; printf '%s' "$GOOGLE_KEY" | node scripts/set-google-books-key.mjs; unset GOOGLE_KEY
import { execFileSync } from 'node:child_process';
import { syncReviewKey } from './sync-review-key.mjs';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const key=Buffer.concat(chunks).toString('utf8').trim();
if (!key || /\s/.test(key) || key.length > 256) throw new Error('Supply a Google Books API key on stdin.');
const group=process.env.LIBRARY_RESOURCE_GROUP || 'pince-rg';
const az=(args,input)=>execFileSync('az',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
const worker=az(['deployment','group','show','-g',group,'-n','pince-covers','--query','properties.outputs.workerName.value','-o','tsv']).trim();
if(!worker)throw new Error('Deploy the library cover worker first.');
// Validate access before changing the live worker's configuration.
const response=await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:9780142410370&maxResults=1&fields=totalItems',{
  headers:{'X-Goog-Api-Key':key},redirect:'error',signal:AbortSignal.timeout(15000),
});
if(!response.ok)throw new Error('Google Books rejected this key (HTTP '+response.status+'). Check API enablement, key restrictions and quota.');
await response.body?.cancel();
az(['functionapp','config','appsettings','set','-g',group,'-n',worker,'--settings','@-','--only-show-errors','-o','none'],
  JSON.stringify({GOOGLE_BOOKS_API_KEY:key}));
syncReviewKey(group,key);
console.log('Google Books API access verified; key stored on the worker and review API.');
