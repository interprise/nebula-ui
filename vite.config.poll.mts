// TEMPORARY — created by Claude to run the dev server while the system's
// inotify watcher budget is exhausted (ENOSPC). Same config as vite.config.ts,
// but the file watcher polls instead of registering inotify watches.
// Delete when no longer needed.
import base from './vite.config'

export default {
  ...base,
  server: {
    ...base.server,
    watch: {
      usePolling: true,
      interval: 1500,
      ignored: ['**/docs/**', '**/dist/**', '**/.git/**'],
    },
  },
}
