import sharp from 'sharp';
import { openLibraryCovers } from './cover-source.js';
import { googleBooksCovers, CoverSourceError } from './google-covers.js';
import { braveCovers } from './brave-covers.js';
import { change } from './store.js';

// Query counts bound repeated imports, manual retries and outage recovery.
function requestBudget(store, record, source, daily, monthly) {
  return {
    before: async () => {
      const now = new Date(), day = now.toISOString().slice(0,10), month = day.slice(0,7);
      await change(store,'system',record,state => {
        const days = Object.fromEntries(Object.entries(state?.days || {}).filter(([d]) => d.startsWith(month)));
        if (state?.blockedUntil > now.getTime()) throw new CoverSourceError(state.reason || 'quota',false,source);
        const used = Object.values(days).reduce((sum,n)=>sum+n,0);
        if ((days[day] || 0) >= daily || used >= monthly) throw new CoverSourceError('localLimit',false,source);
        days[day] = (days[day] || 0) + 1;
        return { days, blockedUntil:0 };
      });
    },
    block: async reason => {
      await change(store,'system',record,state => ({
        ...state,reason,blockedUntil:Date.now()+3600000,
      }));
    },
  };
}
// Google Books lookups are free; only the existing worker and storage are used.
export function googleRequestBudget(store) {
  const budget = requestBudget(store,'google-cover-usage','googlebooks',900,1500);
  return { beforeGoogleQuery: budget.before, blockGoogle: budget.block };
}
// Brave charges $5 per 1,000 searches against $5 of free credit a month. Stopping at 900 keeps
// the month inside that credit, whatever is retried or re-imported.
export function braveRequestBudget(store) {
  const budget = requestBudget(store,'brave-cover-usage','bravesearch',200,900);
  return { beforeBraveQuery: budget.before, blockBrave: budget.block };
}
export async function distinctCovers(covers, limit = 2) {
  const out=[], prints=[];
  for (const cover of covers) {
    try {
      const bytes=Buffer.from(cover.data.split(',')[1],'base64');
      const pixels=await sharp(bytes,{limitInputPixels:20_000_000}).resize(24,32,{fit:'fill'})
        .toColourspace('srgb').removeAlpha().raw().toBuffer();
      if (prints.some(prior=>prior.length===pixels.length &&
          pixels.reduce((sum,v,i)=>sum+Math.abs(v-prior[i]),0)/pixels.length<7)) continue;
      prints.push(pixels);out.push(cover);
      if(out.length>=limit)break;
    } catch { /* Invalid source images never become suggestions. */ }
  }
  return out;
}
/**
 * Up to two covers: the open catalogues first, then, when a Brave key is configured, an image
 * search of bookshop and publisher pages for the editions the catalogues do not hold.
 * A source that fails is named in the warnings when another source still found a cover.
 */
export async function findCovers(book, options = {}) {
  const { openLibrary = openLibraryCovers, googleBooks = googleBooksCovers, braveSearch = braveCovers } = options;
  let covers=[], primaryFailure, fallbackFailure, searchFailure;
  try { covers=await openLibrary(book,options); } catch(error) { primaryFailure=error; }
  if(covers.length>=2)return { covers:covers.slice(0,2), warnings:[] };
  // Keep the total within the worker's claim, including storage: 110 + 35 + 25 seconds of 240.
  try { covers=await distinctCovers([...covers,...await googleBooks(book,{...options,signal:AbortSignal.timeout(35000)})]); }
  catch(error) { fallbackFailure=error; }
  if(covers.length<2 && options.braveKey) {
    try { covers=await distinctCovers([...covers,...await braveSearch(book,{...options,signal:AbortSignal.timeout(25000)})]); }
    catch(error) { searchFailure=error; }
  }
  if(!covers.length) {
    const failure=fallbackFailure || primaryFailure || searchFailure;
    if(failure)throw failure;
  }
  return { covers, warnings:[primaryFailure && 'openlibrary',fallbackFailure && 'googlebooks',searchFailure && 'bravesearch'].filter(Boolean) };
}
