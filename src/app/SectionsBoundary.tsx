/**
 * What the reader sees when a local chunk will not load.
 *
 * The section data is bundled, not fetched from anywhere, so this is rare —
 * but "rare" is not "impossible": a partially-written install, an evicted
 * cache, a webview that drops a request mid-navigation. The old failure mode
 * for that was no failure mode at all, because the data was in the startup
 * chunk and a startup chunk that will not load is a white page.
 *
 * The line this draws: one Scripture surface failing must not take the
 * application with it. The shell stays, the nav stays, Home stays, and the
 * journal — the part that is the reader's own writing — stays editable. Only
 * the surface that genuinely needed the divisions says it could not get them,
 * and it says it once.
 *
 * Nothing here touches storage. A failed render is not a reason to write
 * anything, and an error boundary that "cleaned up" after itself would be the
 * one component in this app able to lose an entry while reporting a problem.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { retrySections } from './sections';
import { Button, EmptyState } from '../components/ui';

type Props = { children: ReactNode; onRetry?: () => void };
type State = { failed: boolean };

export class SectionsBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console, and nowhere else. No banner, no repeated toast, and
    // certainly no network: rule 6 has no exception for diagnostics.
    console.error('A view failed to render', error, info.componentStack);
  }

  private retry = (): void => {
    // Clearing the cached promise is the whole of the retry — see
    // `retrySections`. The boundary then re-renders its children, which ask
    // again from scratch.
    retrySections();
    this.setState({ failed: false });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <EmptyState title="This page could not be loaded">
        {/* Honest about what is and is not affected. Somebody who came here to
            write needs to know they still can, and that nothing of theirs was
            involved in this. */}
        <p>
          Part of this app did not load. Nothing in your journal was changed. If you are using
          the hosted browser edition, reconnect before trying a page that has not loaded on this
          device before.
        </p>
        <p className="mt-3">
          <Button onClick={this.retry}>Try again</Button>
        </p>
      </EmptyState>
    );
  }
}
