import { Component, type ErrorInfo, type ReactNode } from "react";

/*
 * Safety net: if anything throws while rendering, show a reload screen (with the error text)
 * instead of React unmounting everything and leaving a black page you can't tap.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Same Place? crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash">
        <h1>Something went wrong</h1>
        <p>The game hit an error. Reloading usually fixes it.</p>
        <button className="start" onClick={() => window.location.reload()}>
          Reload
        </button>
        <details>
          <summary>Error details</summary>
          <pre>{String(error.stack ?? error.message ?? error)}</pre>
        </details>
      </main>
    );
  }
}
