// Settings for a library running on this computer: the shell's environment, topped up from an
// optional `.env` file beside package.json. The shell wins, and a setting left empty in the file
// counts as not set, so a half-filled copy of `.env.example` can never blank a default.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import util from 'node:util';

export const root = fileURLToPath(new URL('../', import.meta.url));

/** Adds the `.env` file's settings to `env` and returns the names it added. */
export function loadLocalEnv(env = process.env, file = resolve(root, '.env')) {
  // Older versions of Node cannot read the file; the version check explains what to install.
  if (!existsSync(file) || !util.parseEnv) return [];
  const added = [];
  for (const [name, value] of Object.entries(util.parseEnv(readFileSync(file, 'utf8')))) {
    if (value.trim() === '' || (env[name] !== undefined && env[name] !== '')) continue;
    env[name] = value;
    added.push(name);
  }
  return added;
}

/** Where the local catalogue, its images and the generated passwords are kept. */
export const dataFolder = (env = process.env) => resolve(env.LIBRARY_LOCAL_DIR || resolve(root, '.library'));

/** The version of Node this project is built and tested on. */
export const nodeMajor = 22;
export const nodeProblem = (version = process.versions.node) =>
  Number(version.split('.')[0]) === nodeMajor ? null
    : 'Pince needs Node.js ' + nodeMajor + '; this is Node.js ' + version + '. Install Node ' + nodeMajor + ' from https://nodejs.org/ and try again.';
