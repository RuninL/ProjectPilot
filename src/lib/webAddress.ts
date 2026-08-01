const DANGEROUS_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'shell',
  'powershell',
  'cmd',
  'ms-settings',
]);

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;
const HOST_WITH_PORT_PATTERN =
  /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z0-9-]+):\d+(?:[/?#]|$)/i;

function normalizedScheme(value: string): string | null {
  const colon = value.indexOf(':');
  if (colon < 0) return null;
  const candidate = value
    .slice(0, colon)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
  return SCHEME_PATTERN.test(candidate) ? candidate : null;
}

function explicitScheme(value: string): string | null {
  if (HOST_WITH_PORT_PATTERN.test(value)) return null;
  return normalizedScheme(value);
}

function isIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function isSupportedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || isIpv4(host) || host.includes('.');
}

export function cleanWebAddress(value: string): string {
  return value.trim();
}

export function isDangerousWebAddress(value: string): boolean {
  const scheme = normalizedScheme(cleanWebAddress(value));
  return scheme !== null && DANGEROUS_SCHEMES.has(scheme);
}

export function isSchemelessWebAddress(value: string): boolean {
  const cleaned = cleanWebAddress(value);
  if (
    cleaned === '' ||
    /[\u0000-\u0020\u007f]/.test(cleaned) ||
    explicitScheme(cleaned) !== null
  ) {
    return false;
  }
  try {
    const parsed = new URL(cleaned.startsWith('//') ? `https:${cleaned}` : `https://${cleaned}`);
    return isSupportedHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isStorableWebAddress(value: string): boolean {
  const cleaned = cleanWebAddress(value);
  if (cleaned === '' || isDangerousWebAddress(cleaned)) return false;
  const scheme = explicitScheme(cleaned);
  if (scheme !== null) return true;
  return isSchemelessWebAddress(cleaned);
}

export type OpenableWebAddress =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'dangerous' | 'unsupported' | 'invalid' };

export function resolveWebAddressForOpen(value: string): OpenableWebAddress {
  const cleaned = cleanWebAddress(value);
  if (cleaned === '') return { ok: false, reason: 'empty' };
  if (isDangerousWebAddress(cleaned)) return { ok: false, reason: 'dangerous' };

  const scheme = explicitScheme(cleaned);
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(cleaned);
      return isSupportedHost(parsed.hostname)
        ? { ok: true, value: cleaned }
        : { ok: false, reason: 'invalid' };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  if (scheme !== null) return { ok: false, reason: 'unsupported' };
  if (!isSchemelessWebAddress(cleaned)) return { ok: false, reason: 'invalid' };

  const parsed = new URL(cleaned.startsWith('//') ? `https:${cleaned}` : `https://${cleaned}`);
  const host = parsed.hostname.toLowerCase();
  const local =
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    (host.startsWith('172.') &&
      Number(host.split('.')[1]) >= 16 &&
      Number(host.split('.')[1]) <= 31);
  const protocol = local ? 'http:' : 'https:';
  return {
    ok: true,
    value: cleaned.startsWith('//') ? `${protocol}${cleaned}` : `${protocol}//${cleaned}`,
  };
}
