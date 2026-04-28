import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  "description": "Add thread capabilities to Claude",
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["src/fetch-watcher/index.ts"],
      "world": "MAIN",
      "run_at": "document_start"
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["src/content/index.tsx"],
      "css": ["src/styles/content.css"],
      "run_at": "document_idle"
    }
  ],
  // action: {
  //   default_icon: {
  //     48: 'public/logo.png',
  //   },
  //   default_popup: 'src/popup/index.html',
  // },
  // side_panel: {
  //   default_path: 'src/sidepanel/index.html',
  // },
})
