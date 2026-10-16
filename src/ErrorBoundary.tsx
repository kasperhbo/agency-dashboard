import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="page-content" role="alert">
      <section className="panel settings-section">
        <h1>Agency couldn’t display this workspace.</h1>
        <p>Your saved tasks and native session logs are preserved. Reload to try again.</p>
        <button className="button primary" onClick={() => window.location.reload()}>Reload workspace</button>
      </section>
    </main>;
    return this.props.children;
  }
}
