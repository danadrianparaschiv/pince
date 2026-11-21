import { reject } from './store.js';

export const bookFields = { title: 300, authors: 400, isbn: 30, publisher: 200, publishedDate: 10 };
export const spineFields = { rawText: 400, series: 180, volume: 30 };

// Preserve the edition's reported precision. Never invent a month or day.
export function validPublishedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value) || value.startsWith('0000')) return false;
  const full = (value + '-01-01').slice(0, 10);
  const day = new Date(full + 'T00:00:00Z');
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === full;
}

export function readBookField(key, value) {
  if (typeof value !== 'string' || value.length > bookFields[key]) reject(400, 'invalid');
  const text = value.trim();
  if (key === 'title' && !text) reject(400, 'invalid');
  if (key === 'publishedDate' && text && !validPublishedDate(text)) reject(400, 'invalidPublishedDate');
  return text;
}
