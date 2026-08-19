import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CapabilityFile {
  readonly windows: readonly string[];
  readonly permissions: readonly string[];
}

describe('task navigation Tauri capability', () => {
  it('grants only the main window the commands used by the navigation adapter', () => {
    const path = join(process.cwd(), 'src-tauri/capabilities/task-navigation.json');
    const capability = JSON.parse(readFileSync(path, 'utf8')) as CapabilityFile;

    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([
      'core:window:allow-show',
      'core:window:allow-unminimize',
      'core:window:allow-set-focus',
    ]);
  });
});
