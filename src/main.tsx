import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { RouterProvider } from './app/router';
import { StorageContextProvider } from './app/storage';
import { ThemeProvider } from './app/theme';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <StorageContextProvider>
        <RouterProvider>
          <App />
        </RouterProvider>
      </StorageContextProvider>
    </ThemeProvider>
  </StrictMode>,
);
