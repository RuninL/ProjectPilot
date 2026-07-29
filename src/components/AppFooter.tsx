import { useState } from 'react';
import { cn } from '@/lib/cn';
import { APP_AUTHOR, APP_VERSION, CONTACT_EMAIL } from '@/lib/appMetadata';

interface ContactEmailProps {
  className?: string;
}

export function ContactEmail({ className }: ContactEmailProps) {
  const [message, setMessage] = useState<string | null>(null);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setMessage('邮箱已复制到剪贴板。');
    } catch {
      setMessage('复制失败，请手动复制邮箱。');
    }
  };

  return (
    <span className={cn('inline-flex flex-wrap items-center justify-center gap-x-2', className)}>
      <button
        type="button"
        className="hover:text-foreground hover:underline"
        onClick={() => void copyEmail()}
      >
        {CONTACT_EMAIL}
      </button>
      {message !== null && (
        <span className="text-xs" role="status">
          {message}
        </span>
      )}
    </span>
  );
}

export function AppFooter() {
  return (
    <footer className="shrink-0 px-6 py-3 text-center text-xs text-muted-foreground">
      <span>Made by {APP_AUTHOR} · </span>
      <ContactEmail />
      <span> · v{APP_VERSION}</span>
    </footer>
  );
}
