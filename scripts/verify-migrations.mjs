import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationDirectory = join(root, 'src-tauri', 'migrations');
const lockPath = 'src-tauri/migrations.lock.json';
const releaseMode = process.argv.includes('--release');
const baseArgument = process.argv.indexOf('--base-ref');
const baseRef = baseArgument === -1 ? null : process.argv[baseArgument + 1];

function fail(message) {
  console.error(`Migration history check failed: ${message}`);
  process.exit(1);
}

function readLock(content) {
  const parsed = JSON.parse(content);
  if (parsed.algorithm !== 'sha256' || !Array.isArray(parsed.migrations)) {
    fail('migrations.lock.json has an unsupported format');
  }
  return parsed.migrations;
}

const locked = readLock(readFileSync(join(root, lockPath), 'utf8'));
const files = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

if (locked.length > files.length) {
  fail('a locked migration was deleted or renamed');
}

for (const [index, entry] of locked.entries()) {
  const expectedVersion = index + 1;
  const expectedPrefix = String(expectedVersion).padStart(4, '0');
  if (
    entry.version !== expectedVersion ||
    !entry.file.startsWith(`${expectedPrefix}_`) ||
    files[index] !== entry.file
  ) {
    fail(`locked migration ${expectedVersion} was deleted, renamed, or reordered`);
  }
  const bytes = readFileSync(join(migrationDirectory, entry.file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256) {
    fail(`${entry.file} was modified after publication`);
  }
}

for (const [index, file] of files.entries()) {
  const version = Number(file.slice(0, 4));
  if (version !== index + 1) {
    fail(`${file} does not continue the contiguous migration sequence`);
  }
}

if (releaseMode && locked.length !== files.length) {
  fail('release builds must lock every migration hash');
}

if (baseRef) {
  let baseLocked;
  try {
    baseLocked = readLock(
      execFileSync('git', ['show', `${baseRef}:${lockPath}`], {
        encoding: 'utf8',
      }),
    );
  } catch {
    baseLocked = [];
  }
  for (const [index, entry] of baseLocked.entries()) {
    if (JSON.stringify(locked[index]) !== JSON.stringify(entry)) {
      fail(`locked migration ${entry.version} changed relative to ${baseRef}`);
    }
  }
}

console.log(
  `Verified ${locked.length} immutable migration hashes${
    files.length > locked.length
      ? ` and ${files.length - locked.length} higher-version addition(s)`
      : ''
  }.`,
);
