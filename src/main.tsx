import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { ViewProvider } from './context/ViewContext';
import { AppStateProvider } from './context/AppStateContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ViewProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </ViewProvider>
    </ThemeProvider>
  </StrictMode>,
);
