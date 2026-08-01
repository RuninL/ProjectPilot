import { describe, expect, it } from 'vitest';
import {
  cleanWebAddress,
  isDangerousWebAddress,
  isStorableWebAddress,
  resolveWebAddressForOpen,
} from '@/lib/webAddress';

describe('web addresses', () => {
  it.each([
    'www.perplexity.ai/search/e4862adc-6fe6-447b-9d00-7db33769971c',
    'perplexity.ai/search/abc',
    'www.example.com/path',
    'example.com/path?query=1#result',
    'https://example.com',
    'http://example.com',
    'localhost:3000',
    '127.0.0.1:5173',
    '192.168.1.20:8080/dashboard',
  ])('allows a safe stored address without rewriting %s', (value) => {
    expect(isStorableWebAddress(value)).toBe(true);
    expect(cleanWebAddress(` ${value} `)).toBe(value);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,test',
    'file:///C:/secret',
    'vbscript:test',
    'shell:test',
    'powershell:test',
    'cmd:test',
    'ms-settings:test',
  ])('detects dangerous protocol input %s', (value) => {
    expect(isDangerousWebAddress(value)).toBe(true);
    expect(isStorableWebAddress(value)).toBe(false);
    expect(resolveWebAddressForOpen(value)).toMatchObject({ ok: false, reason: 'dangerous' });
  });

  it.each([
    ['www.example.com/path', 'https://www.example.com/path'],
    ['example.com/path', 'https://example.com/path'],
    ['https://example.com/path', 'https://example.com/path'],
    ['http://example.com/path', 'http://example.com/path'],
    ['localhost:3000', 'http://localhost:3000'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['192.168.1.20:8080/dashboard', 'http://192.168.1.20:8080/dashboard'],
  ])('resolves %s only for opening', (stored, opened) => {
    expect(resolveWebAddressForOpen(stored)).toEqual({ ok: true, value: opened });
  });

  it('does not execute an unknown scheme', () => {
    expect(isStorableWebAddress('ftp://example.com/file')).toBe(true);
    expect(resolveWebAddressForOpen('ftp://example.com/file')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});
