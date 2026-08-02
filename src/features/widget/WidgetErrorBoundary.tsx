import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

/**
 * Desktop-widget-scoped React error boundary. A render crash inside the
 * widget must never leave a blank transparent window or affect the main
 * window, so it renders a visible Chinese error panel with a retry.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <main className="m-2 rounded-lg border bg-background/90 p-4 text-foreground" role="alert">
        <h1 className="font-semibold">桌面小窗出现错误</h1>
        <p className="mt-1 break-all text-sm text-muted-foreground">{this.state.error}</p>
        <button
          type="button"
          className="mt-3 rounded border px-3 py-1 text-sm"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          重试
        </button>
      </main>
    );
  }
}
