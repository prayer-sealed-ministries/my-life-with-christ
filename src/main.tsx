import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { DATA_PROFILE } from './app/data';
import { RouterProvider } from './app/router';
import { StorageContextProvider } from './app/storage';
import { ThemeProvider } from './app/theme';
import { bindAndroidBack, browserHistoryHost } from './platform/native-back';
import { PlatformProvider } from './platform/provider';
import './index.css';

// The build states which data scheme it carries, rather than leaving it to be
// inferred. `dist/` holds whichever profile was built last, and the end-to-end
// suite was guessing from the shape of a book page — a guess that could only
// tell `refs-only` from everything else, so it labelled a `public` build
// `full` and nobody noticed. Something that can be read is not a guess.
document.documentElement.dataset.dataProfile = DATA_PROFILE;

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');

// Android's system back, bound once at startup inside the platform layer.
// A no-op everywhere else, so the web build is unaffected and no view learns
// that Android exists. Failure to bind must not stop the app from starting.
void bindAndroidBack(browserHistoryHost()).catch(() => undefined);

createRoot(root).render(
  <StrictMode>
    {/* The platform sits outermost: storage selection and every file operation
        below it are capabilities of the edition, not of the journal. Defaults
        to the web implementations, so nothing that does not opt in changes. */}
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider>
          <RouterProvider>
            <App />
          </RouterProvider>
        </StorageContextProvider>
      </ThemeProvider>
    </PlatformProvider>
  </StrictMode>,
);
