// Dev server for this machine, where Eclipse holds most of the inotify watcher
// budget and `npm run dev` dies with ENOSPC. Same config as vite.config.ts, but
// the file watcher polls instead of registering inotify watches.
// Used by .claude/skills/verify: npx vite --config vite.config.poll.mts
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
