import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const DATA_DIR = path.join(ROOT, 'data');

// A small JSON file store. Fine for one process and a few thousand records;
// swap for SQLite or Postgres if a client project outgrows it.
export class Store {
  constructor(name, fallback) {
    mkdirSync(DATA_DIR, { recursive: true });
    this.file = path.join(DATA_DIR, name);
    try {
      this.data = { ...fallback, ...JSON.parse(readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[store] ${name} unreadable, starting empty: ${err.message}`);
      this.data = structuredClone(fallback);
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}

export function openStores() {
  return {
    users: new Store('users.json', { users: {} }),
    leads: new Store('leads.json', { leads: [] }),
    posted: new Store('posted.json', { posts: [] }),
    state: new Store('state.json', { nextPost: 0, lastSlot: null, paused: false, relay: {} }),
  };
}
