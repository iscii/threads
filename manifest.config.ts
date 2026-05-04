import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    16: 'public/icon-16.png',
    32: 'public/icon-32.png',
    48: 'public/icon-48.png',
    128: 'public/icon-128.png',
  },
  "description": "Add inline side threads to chatbot conversations",
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
  //     16: 'public/icon-16.png',
  //     32: 'public/icon-32.png',
  //     48: 'public/icon-48.png',
  //     128: 'public/icon-128.png',
  //   },
  //   default_popup: 'src/popup/index.html',
  // },
  // side_panel: {
  //   default_path: 'src/sidepanel/index.html',
  // },
})
