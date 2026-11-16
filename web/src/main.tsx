import { render } from 'preact';
import { App } from './app';
import { initTheme } from './theme';
import './styles.css';

initTheme();
render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
