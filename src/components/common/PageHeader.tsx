import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

/** Standard page title, explanation, and single primary-action area. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
