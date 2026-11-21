// Stores a Brave Search API key on the cover worker, the only place that uses it.
// Asks for the key without showing it, so it is absent from command arguments and shell history.
// Usage: node scripts/set-brave-search-key.mjs, or ./scripts/deploy.sh keys, which asks for both optional keys.
// A key piped on stdin is used instead of asking: printf '%s' "$BRAVE_KEY" | node scripts/set-brave-search-key.mjs
import { execFileSync } from 'node:child_process';
import { braveQuery, braveSearchUrl } from '../api/src/brave-covers.js';

const stop=message=>{ console.error(message); process.exit(1); };
// Typed or pasted at the terminal with nothing echoed; Enter finishes, Ctrl+C cancels.
function ask(prompt) {
  return new Promise(resolve=>{
    const input=process.stdin; let text='';
    process.stderr.write(prompt);
    input.setRawMode(true); input.resume();
    input.on('data',function read(chunk) {
      for(const char of chunk.toString('utf8').replace(/\x1b\[20[01]~/g,'')) {
        if(char==='\r' || char==='\n' || char==='\x03' || char==='\x04') {
          input.setRawMode(false); input.pause(); input.off('data',read);
          process.stderr.write('\n');
          if(char==='\x03')stop('Cancelled; nothing was changed.');
          return resolve(text);
        }
        if(char==='\x7f' || char==='\b')text=text.slice(0,-1);
        else text+=char;
      }
    });
  });
}
async function piped() {
  const chunks=[]; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
const key=(process.stdin.isTTY ? await ask('Paste the Brave Search API key and press Enter (it stays hidden): ') : await piped()).trim();
if(!key)stop('No key was received, so nothing was changed. Run the command again, paste the key, then press Enter.');
if(/\s/.test(key) || key.length>256)stop('That does not look like one API key (it has spaces or is too long). Nothing was changed.');
const group=process.env.LIBRARY_RESOURCE_GROUP || 'pince-rg';
const az=(args,input)=>execFileSync('az',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
let worker='';
try{ worker=az(['deployment','group','show','-g',group,'-n','pince-covers','--query','properties.outputs.workerName.value','-o','tsv']).trim(); }
catch{ /* Reported just below. */ }
if(!worker)stop('The cover worker of this library was not found. Deploy it first with: ./scripts/deploy.sh covers. Nothing was changed.');
// One search, in exactly the shape the worker sends, before changing the live configuration.
const response=await fetch(braveSearchUrl(braveQuery({title:'Jurnalul unui puști',authors:'Jeff Kinney',publisher:'Arthur'})),{
  headers:{Accept:'application/json','X-Subscription-Token':key},redirect:'error',signal:AbortSignal.timeout(15000),
}).catch(()=>stop('Brave Search did not answer. Check your connection. Nothing was changed.'));
if(!response.ok){
  await response.body?.cancel();
  stop('Brave Search rejected this request (HTTP '+response.status+'). Check the key, its plan and remaining credit. Nothing was changed.');
}
const results=(await response.json())?.results;
az(['functionapp','config','appsettings','set','-g',group,'-n',worker,'--settings','@-','--only-show-errors','-o','none'],
  JSON.stringify({BRAVE_SEARCH_API_KEY:key}));
console.log('Brave image search verified ('+(Array.isArray(results)?results.length:0)+' results for a sample title); key stored on the cover worker.');
