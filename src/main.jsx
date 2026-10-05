import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { boot, S, TAB_DEFS, actions, player } from './app/store.js';
import './styles/app.css'; // last, so it wins over the React Bits component styles above

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
window.__moodwave = { ...(window.__moodwave ?? {}), S, TAB_DEFS, actions, player }; // handy for debugging in the console
boot();
