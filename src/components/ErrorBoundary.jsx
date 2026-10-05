import { Component } from 'react';

/** If something throws while rendering, say so instead of leaving a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) { console.error('Moodwave crashed while rendering', error, info?.componentStack); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something broke</h1>
        <p className="muted">{String(this.state.error.message ?? this.state.error)}</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
