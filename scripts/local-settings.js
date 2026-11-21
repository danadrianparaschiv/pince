// Settings saved from the app itself, by the set-up screen and by Family settings. They are kept
// in the data folder beside the catalogue, readable by you only. The shell and `.env` win over
// this file, so a library that was set up by hand keeps working exactly as before.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The outside services the app can be given keys for, and the settings each one needs. */
export const services = {
  recognition: ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_KEY'],
  textDetection: ['AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY'],
  googleBooks: ['GOOGLE_BOOKS_API_KEY'],
  braveSearch: ['BRAVE_SEARCH_API_KEY'],
};
const saveable = new Set(Object.values(services).flat());
export const filled = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';
export const settingsFile = (folder) => resolve(folder, 'settings.json');

/** The saved settings, or null when the app has never saved any. Unknown names are dropped. */
export function readSettings(folder) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(settingsFile(folder), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(
      'The saved settings in ' + settingsFile(folder) + ' cannot be read. Fix the file, or delete it and add the service keys again.',
    );
  }
  const values = {};
  for (const [name, value] of Object.entries(saved?.values ?? {}))
    if (saveable.has(name) && typeof value === 'string' && value.trim() !== '') values[name] = value;
  return { setup: saved?.setup === 'pending' ? 'pending' : 'done', values };
}

/** Replaces the file in one step, so a crash never leaves half of it. */
export function writeSettings(folder, settings) {
  const file = settingsFile(folder);
  writeFileSync(file + '.new', JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  renameSync(file + '.new', file);
}

/** Adds the saved settings to `env` where the shell and `.env` set nothing; returns the names it added. */
export function loadSavedSettings(env, folder) {
  const added = [];
  for (const [name, value] of Object.entries(readSettings(folder)?.values ?? {})) {
    if (filled(env, name)) continue;
    env[name] = value;
    added.push(name);
  }
  return added;
}
