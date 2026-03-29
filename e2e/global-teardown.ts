/**
 * Playwright global teardown: restores the original .env file
 * that was backed up by global-setup.ts.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(import.meta.dirname, '..', '.env');
const BACKUP_PATH = ENV_PATH + '.e2e-backup';
const DEV_ENV_PATH = resolve(import.meta.dirname, '..', '.env.dev');

export default function globalTeardown() {
  if (existsSync(BACKUP_PATH)) {
    // Restore the original .env
    const original = readFileSync(BACKUP_PATH, 'utf-8');
    writeFileSync(ENV_PATH, original);
    unlinkSync(BACKUP_PATH);
  } else if (existsSync(DEV_ENV_PATH)) {
    // No backup — restore from .env.dev if it exists
    const devEnv = readFileSync(DEV_ENV_PATH, 'utf-8');
    writeFileSync(ENV_PATH, devEnv);
  } else {
    // No backup and no .env.dev — remove the test .env
    if (existsSync(ENV_PATH)) {
      unlinkSync(ENV_PATH);
    }
  }
}
