import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/vt323/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme/tokens.css';
import './theme/global.css';
import './theme/panel.css';
import './theme/fx.css';

const root = document.getElementById('root');
if (!root) throw new Error('root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
