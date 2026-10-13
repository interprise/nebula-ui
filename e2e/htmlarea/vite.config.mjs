// Config Vite dedicata alla pagina di prova di HtmlAreaControl.
// base '/' e root = radice del repo, cosi' l'harness fuori da `src` e gli
// import verso `src` si risolvono; polling perche' il budget inotify della
// macchina e' spesso esaurito (come vite.config.poll.mts). Non tocca il build
// di produzione (lo fa `vite.config.ts`).
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default {
  root: repoRoot,
  base: '/',
  plugins: [react()],
  server: {
    watch: { usePolling: true, interval: 1500, ignored: ['**/docs/**', '**/dist/**', '**/.git/**'] },
  },
};
