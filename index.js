import './App.scss';
import App from './App.svelte';

// window.app = new App({
//   target: document.getElementsByTagName('app')[0]
// });

const app = new App({
  target: document.body
});

export default app;
