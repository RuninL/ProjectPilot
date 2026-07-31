/** Error categories that map to distinct UI treatments (see architecture.md §8). */
export type AppErrorKind =
  | 'validation' // inline form errors
  | 'db' // toast + retry
  | 'not_found' // redirect to empty state
  | 'conflict' // e.g. duplicate conversion; notify + refresh
  | 'unknown';

/** Application-level error with a user-readable (Simplified Chinese) message and retry hint. */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    kind: AppErrorKind,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.retryable = options?.retryable ?? kind === 'db';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Shape emitted by Rust custom commands (see error.rs). */
interface CommandErrorShape {
  code: string;
  message: string;
}

function isCommandErrorShape(value: unknown): value is CommandErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

/** Tauri plugin invocations can reject with a string or a `{ message }` object. */
function pluginErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const message = value.trim();
    return message === '' ? null : message.slice(0, 500);
  }
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const candidate = (value as Record<string, unknown>).message;
    if (typeof candidate !== 'string') return null;
    const message = candidate.trim();
    return message === '' ? null : message.slice(0, 500);
  }
  return null;
}

/** Normalize an unknown thrown value into an AppError. */
export function toAppError(value: unknown): AppError {
  if (value instanceof AppError) {
    return value;
  }
  if (isCommandErrorShape(value)) {
    const kind: AppErrorKind = value.code === 'INVALID' ? 'validation' : 'db';
    return new AppError(kind, value.message, { cause: value });
  }
  if (value instanceof Error) {
    return new AppError('unknown', value.message, { cause: value });
  }
  const pluginMessage = pluginErrorMessage(value);
  if (pluginMessage !== null) {
    return new AppError('db', pluginMessage, { cause: value });
  }
  return new AppError('unknown', '发生未知错误', { cause: value });
}
