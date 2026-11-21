import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export class LocalStore {
  constructor(directory) {
    this.images = join(directory, 'covers');
    mkdirSync(this.images, { recursive: true, mode: 0o700 });
    // The database holds password hashes, sessions and private notes. It is readable by its
    // owner only, wherever the data folder is; SQLite gives its side files the same permissions.
    const database = join(directory, 'library.sqlite');
    closeSync(openSync(database, 'a', 0o600));
    this.db = new DatabaseSync(database);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS entities (bucket TEXT, key TEXT, version INTEGER, data TEXT, PRIMARY KEY(bucket,key))',
    );
    for (const file of [database, database + '-wal', database + '-shm']) if (existsSync(file)) chmodSync(file, 0o600);
  }
  async get(group, key) {
    const row = this.db
      .prepare('SELECT version,data FROM entities WHERE bucket=? AND key=?')
      .get(group, key);
    return row ? { etag: row.version, value: JSON.parse(row.data) } : null;
  }
  async cas(group, key, etag, value) {
    const json = JSON.stringify(value);
    const result = etag
      ? this.db
          .prepare('UPDATE entities SET version=version+1,data=? WHERE bucket=? AND key=? AND version=?')
          .run(json, group, key, etag)
      : this.db.prepare('INSERT OR IGNORE INTO entities VALUES (?,?,1,?)').run(group, key, json);
    return result.changes === 1;
  }
  async list(group) {
    return this.db
      .prepare('SELECT data FROM entities WHERE bucket=?')
      .all(group)
      .map((row) => JSON.parse(row.data));
  }
  async putImage(name, bytes) {
    await writeFile(join(this.images, name), bytes, { mode: 0o600 });
  }
  async getImage(name) {
    return readFile(join(this.images, name));
  }
  async deleteImage(name) {
    await rm(join(this.images, name), { force: true });
  }
}
