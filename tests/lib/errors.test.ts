import { describe, expect, it } from 'vitest';
import { toAppError } from '@/lib/errors';

describe('toAppError', () => {
  it('keeps a Tauri plugin string message instead of replacing it with unknown error text', () => {
    const error = toAppError('failed to load sqlite:projectpilot.db: permission denied');

    expect(error.kind).toBe('db');
    expect(error.message).toContain('sqlite:projectpilot.db');
  });

  it('keeps a Tauri plugin object message without exposing a stack', () => {
    const error = toAppError({ message: 'migration failed', stack: 'private stack' });

    expect(error.kind).toBe('db');
    expect(error.message).toBe('migration failed');
  });
});
