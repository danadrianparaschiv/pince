import { bookFields, readBookField, spineFields, validPublishedDate } from './book-metadata.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { authorMatches, cleanISBN, clientName } from './cover-source.js';
import { googleRequestBudget } from './cover-providers.js';
import { change, reject } from './store.js';

const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
  .replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reviewInput(value) {
  if (!value || typeof value !== 'object') reject(400,'invalid');
  const out = {};
  for (const key of Object.keys(bookFields)) out[key] = readBookField(key, value[key] ?? '');
  for (const [key, limit] of Object.entries(spineFields)) {
    if (value[key] == null) continue;
    if (typeof value[key] !== 'string' || value[key].length > limit) reject(400, 'invalid');
    if (value[key].trim()) out[key] = value[key].trim();
  }
  return out;
}
function similarity(a,b) {
  if(a===b)return 1;
  if(!a || !b)return 0;
  let prior=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++){
    const next=[i+1];
    for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,prior[j+1]+1,prior[j]+(a[i]===b[j]?0:1)));
    prior=next;
  }
  return 1-prior[b.length]/Math.max(a.length,b.length);
}
function volumeNumber(text) {
  return fold(text).match(/\b(?:vol(?:ume|umul)?|nr|numarul|book|cartea|part|partea) (\d+|[ivxlcdm]+)\b/)?.[1];
}
function titleEvidence(input, candidateTitle) {
  const title = fold(input.title);
  const candidate = fold(candidateTitle);
  const series = fold(input.series);
  const prefix = series && series + ' ';
  const distinctive = prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
  const candidatePart = prefix && candidate.startsWith(prefix) ? candidate.slice(prefix.length) : candidate;
  const [base, ...suffix] = String(candidateTitle).split(/\s*[:–—]\s*|\s+-\s+/);
  const seriesOnly = Boolean(series && series === title);
  let score = similarity(title, candidate);
  if (series && !seriesOnly && (title.startsWith(prefix) || candidate.startsWith(prefix)))
    score = similarity(distinctive, candidatePart);
  if (title.replace(/^(?:the|an|a) /, '') === candidate.replace(/^(?:the|an|a) /, ''))
    score = Math.max(score, .98);
  if (suffix.length) {
    const [inputBase, ...inputSuffix] = input.title.split(/\s*[:–—]\s*|\s+-\s+/);
    if (fold(inputBase) === fold(base) && inputSuffix.length)
      score = Math.min(score, similarity(fold(inputSuffix.join(' ')), fold(suffix.join(' '))));
    else if (title === fold(base) || title === fold(suffix.join(' '))) score = Math.max(score, .90);
  }
  if (seriesOnly && candidate.startsWith(prefix)) score = .90;
  return { score, seriesOnly };
}
export function rankCandidates(input, candidates) {
  const ranked = [];
  for (const candidate of candidates) {
    if (typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 300 ||
        !Array.isArray(candidate.authors) || !candidate.authors.every(a => typeof a === 'string' && a.length <= 200)) continue;
    const names = candidate.authors.map(a => a.trim()).filter(Boolean);
    const authors = names.join(', ');
    if (authors.length > bookFields.authors) continue;
    const title = titleEvidence(input, candidate.title);
    const authorMatch = Boolean(input.authors) && authorMatches(input.authors, names);
    const isbnMatch = Boolean(cleanISBN(input.isbn)) && candidate.isbns?.includes(cleanISBN(input.isbn));
    if (!isbnMatch && title.score < (authorMatch ? .70 : .88)) continue;
    const wantedVolume = volumeNumber(input.volume) || fold(input.volume) || volumeNumber(input.title);
    const foundVolume = volumeNumber(candidate.title);
    if (wantedVolume && foundVolume && wantedVolume !== foundVolume) continue;

    const publisher = typeof candidate.publisher === 'string' && candidate.publisher.length <= bookFields.publisher
      ? candidate.publisher.trim() : '';
    const publishedDate = validPublishedDate(candidate.publishedDate) ? candidate.publishedDate : '';
    const publisherMatch = Boolean(input.publisher && publisher && fold(input.publisher) === fold(publisher));
    const dateMatch = Boolean(input.publishedDate && publishedDate &&
      (input.publishedDate.startsWith(publishedDate) || publishedDate.startsWith(input.publishedDate)));
    const editionConflict = (input.publisher && publisher && !publisherMatch) ||
      (input.publishedDate && publishedDate && !dateMatch);
    const exact = !editionConflict && (isbnMatch || (!title.seriesOnly && title.score === 1 &&
      (!wantedVolume || wantedVolume === foundVolume) && authorMatch));
    const score = (isbnMatch ? 2 : title.score) + (authorMatch ? .10 : 0) + (publisherMatch ? .06 : 0) +
      (dateMatch ? .04 : 0) + (wantedVolume && wantedVolume === foundVolume ? .10 : 0) - (editionConflict ? .20 : 0);
    ranked.push({ title: candidate.title.trim(), authors, isbn: input.isbn || '', publisher: publisher || input.publisher || '',
      publishedDate: dateMatch && input.publishedDate.length > publishedDate.length ? input.publishedDate : publishedDate || input.publishedDate || '',
      source: candidate.source, sourceUrl: candidate.sourceUrl, exact: Boolean(exact), score });
  }
  const result = [], seen = new Set();
  for (const {score, ...candidate} of ranked.sort((a,b) => Number(b.exact) - Number(a.exact) || b.score - a.score)) {
    const key = JSON.stringify([fold(candidate.title), fold(candidate.authors), fold(candidate.publisher), candidate.publishedDate]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length === 3) break;
  }
  return result;
}

function catalogTitle(info) {
  if (!info || typeof info.title !== 'string') return '';
  if (typeof info.subtitle !== 'string' || !info.subtitle.trim() || fold(info.title).endsWith(fold(info.subtitle))) return info.title;
  return info.title + ': ' + info.subtitle;
}
async function jsonBody(response) {
  if(!response.ok){await response.body?.cancel();throw Error('Catalog unavailable');}
  if(Number(response.headers.get('content-length'))>750000){await response.body?.cancel();throw Error('Catalog response too large');}
  const chunks=[];let size=0;
  for await(const bytes of response.body){size+=bytes.length;if(size>750000)throw Error('Catalog response too large');chunks.push(bytes);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function searchBookDetails(input,{apiKey,fetcher=fetch,beforeGoogleQuery=async()=>{},blockGoogle=async()=>{},beforeRequest=async()=>{}}={}) {
  const candidates=[],warnings=[];
  const series = input.series && !fold(input.title).includes(fold(input.series)) ? input.series : '';
  const query = [input.title, series].filter(Boolean).join(' ');
  if(apiKey)try{
    await beforeGoogleQuery();await beforeRequest();
    const isbn=cleanISBN(input.isbn);
    const params=new URLSearchParams({q:/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)?'isbn:'+isbn:
      'intitle:"'+input.title.replace(/["\\]/g,' ')+'"' + (series ? ' '+series.replace(/["\\]/g,' ') : ''),maxResults:'10',printType:'books',
      fields:'items(id,volumeInfo(title,subtitle,authors,publisher,publishedDate,industryIdentifiers)),totalItems'});
    const response=await fetcher('https://www.googleapis.com/books/v1/volumes?'+params,{
      redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','X-Goog-Api-Key':apiKey}});
    if([400,401,403,429].includes(response.status))await blockGoogle(response.status===429?'quota':'access');
    const data=await jsonBody(response);
    for(const row of (Array.isArray(data.items)?data.items:[]).slice(0,10)){
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(row.id||''))continue;
      candidates.push({title:catalogTitle(row.volumeInfo),publisher:row.volumeInfo?.publisher,publishedDate:row.volumeInfo?.publishedDate,authors:row.volumeInfo?.authors||[],
        isbns:(row.volumeInfo?.industryIdentifiers||[]).filter(i=>['ISBN_10','ISBN_13'].includes(i.type)).map(i=>cleanISBN(i.identifier)),
        source:'googlebooks',sourceUrl:'https://books.google.com/books?id='+row.id});
    }
  }catch{warnings.push('googlebooks');}
  if(!rankCandidates(input,candidates).some(c=>c.exact))try{
    await beforeRequest();
    const params=new URLSearchParams({q:query,limit:'10',fields:'key,title,author_name,editions,editions.title,editions.subtitle,editions.publisher,editions.publish_date'});
    const response=await fetcher('https://openlibrary.org/search.json?'+params,{
      redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json',
        'User-Agent':clientName()}});
    const data=await jsonBody(response);
    for(const row of (Array.isArray(data.docs)?data.docs:[]).slice(0,10)){
      if(!/^\/works\/OL\d+W$/.test(row.key||''))continue;
      const work = {authors:row.author_name || [],source:'openlibrary',sourceUrl:'https://openlibrary.org'+row.key};
      for (const edition of (row.editions?.docs || []).slice(0,5)) {
        const first = field => Array.isArray(field) ? field[0] : field;
        candidates.push({...work, title:catalogTitle(edition), publisher:first(edition.publisher), publishedDate:first(edition.publish_date)});
      }
      candidates.push({...work,title:row.title});
    }
  }catch{warnings.push('openlibrary');}
  const ranked=rankCandidates(input,candidates);
  return {status:ranked.some(c=>c.exact)?'matched':ranked.length?'suggestions':warnings.length?'unavailable':'unmatched',
    candidates:ranked,warnings};
}
export async function reviewBook(store,env,value,{provider=searchBookDetails,wait=delay}={}) {
  const input=reviewInput(value), key=hash(input), now=Date.now();
  const cached=(await store.get('book-reviews',key))?.value;
  if(cached?.expiresAt>now)return {key:cached.receipt,...cached.result};
  const lease=randomUUID();
  // Across all sessions: no parallel review searches or repeated paid/remote work.
  await change(store,'system','book-review-lock',s=>{
    if(s?.until>now)reject(409,'reviewBusy');
    return {lease,until:now+35000};
  });
  try{
    let result;
    try{result=await provider(input,{apiKey:env.GOOGLE_BOOKS_API_KEY,...googleRequestBudget(store),beforeRequest:()=>wait(1100)});}
    catch{result={status:'unavailable',candidates:[],warnings:[]};}
    result.checkedAt=new Date().toISOString();
    const receipt=randomUUID();
    await change(store,'book-review-receipts',receipt,()=>({input,result}));
    await change(store,'book-reviews',key,()=>({receipt,result,expiresAt:Date.now()+(result.status==='unavailable'?60000:7*86400000)}));
    return {key:receipt,...result};
  }finally{await change(store,'system','book-review-lock',s=>s?.lease===lease?{until:0}:s);}
}
export async function validatePhotoReviews(store,rows) {
  if(!Array.isArray(rows))return; // The book writer supplies its ordinary validation.
  for(const row of rows){
    if(row?.source!=='photo'){if(row)delete row.catalogSource;continue;}
    const proof=row.photoReview;
    if(!proof || !/^[a-f0-9-]{36}$/.test(proof.key||'') || !Number.isInteger(proof.choice))reject(400,'reviewRequired');
    const record=(await store.get('book-review-receipts',proof.key))?.value;
    // The stored receipt is also valid for an idempotent save retry after cache expiry.
    const choices=record && [record.input,...record.result.candidates];
    const chosen=choices?.[proof.choice], current=reviewInput(row);
    if(!chosen || Object.keys(bookFields).some(k=>(chosen[k] ?? '')!==current[k]))reject(400,'reviewRequired');
    row.catalogSource = proof.choice > 0 && chosen.source === 'googlebooks' ? {
      source:'googlebooks',sourceId:new URL(chosen.sourceUrl).searchParams.get('id'),
    } : null;
  }
}
