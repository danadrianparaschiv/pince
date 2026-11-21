// Keep the existing Books-only credential server-side on the metadata review API.
// All settings are captured in memory and passed to ARM through stdin.
// The Azure CLI reads them as '@-'. The /dev/stdin path fails on Linux, where Node supplies input over a socket.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function syncReviewKey(group=process.env.LIBRARY_RESOURCE_GROUP || 'pince-rg', key) {
  const az=(args,input)=>{
    try{return execFileSync('az',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});}
    catch{throw Error('Unable to synchronize the Google Books review setting. Check Azure access.');}
  };
  if(key===undefined){
    const worker=az(['deployment','group','show','-g',group,'-n','pince-covers','--query','properties.outputs.workerName.value','-o','tsv']).trim();
    key=JSON.parse(az(['functionapp','config','appsettings','list','-g',group,'-n',worker,'-o','json']))
      .find(s=>s.name==='GOOGLE_BOOKS_API_KEY')?.value || '';
  }
  const site=az(['deployment','group','show','-g',group,'-n','pince-infra','--query','properties.outputs.siteName.value','-o','tsv']).trim();
  const info=JSON.parse(az(['staticwebapp','show','-g',group,'-n',site,'-o','json']));
  const settings=JSON.parse(az(['staticwebapp','appsettings','list','-g',group,'-n',site,'-o','json'])).properties;
  if(settings.GOOGLE_BOOKS_API_KEY===key)return;
  settings.GOOGLE_BOOKS_API_KEY=key;
  az(['rest','--method','put','--url','https://management.azure.com'+info.id+'/config/appsettings?api-version=2024-11-01',
    '--body','@-','--only-show-errors','-o','none'],JSON.stringify({properties:settings}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  syncReviewKey();console.log('Google Books review setting synchronized securely.');
}
