import { EmptyState } from './EmptyState';

interface PlaceholderPageProps {
  title: string;
  description: string;
}

/** Unified page for navigation entries whose features open in a later phase. */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      <EmptyState title="功能将在后续阶段开放" description={description} />
    </div>
  );
}
