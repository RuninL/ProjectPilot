import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('release metadata', () => {
  it('keeps package, Cargo, and Tauri versions aligned for v1.1.0', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const cargoToml = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
    const tauriConfig = JSON.parse(
      readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as {
      version: string;
    };

    expect(packageJson.version).toBe('1.1.0');
    expect(cargoToml).toMatch(/^version = "1\.1\.0"$/m);
    expect(tauriConfig.version).toBe(packageJson.version);
  });
});
