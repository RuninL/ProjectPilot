import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  label?: string;
}

/** Generic loading indicator for async views. */
export function LoadingState({ label = '加载中…' }: LoadingStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground"
      role="status"
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
