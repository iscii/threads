threads
├── build.js
├── manifest.json
├── tsconfig.json
├── package.json
├── dist/                        ← esbuild output
│   ├── content.js
│   ├── fetch-watcher.js
│   └── content.css
└── src/
    ├── content/
    │   ├── index.tsx
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── Block.tsx
    │   │   ├── Thread.tsx
    │   │   ├── ThreadExchange.tsx
    │   │   └── Badge.tsx
    │   ├── hooks/
    │   │   ├── useObserver.ts
    │   │   ├── useInputDirty.ts
    │   │   ├── useQueue.ts
    │   │   └── useSummary.ts
    │   └── lib/
    │       ├── adapter.ts
    │       ├── injector.ts
    │       ├── keys.ts
    │       ├── summaryStore.ts
    │       ├── threads.ts
    │       └── types.ts
    ├── fetch-watcher/
    │   └── index.ts             ← MAIN world entry, thin shell
    ├── styles/
    │   └── content.css
    └── platforms/
        ├── claude/
        │   ├── index.ts
        │   ├── dom.ts
        │   ├── network.ts
        │   └── theme.ts
        ├── chatgpt/
        │   └── ...
        └── deepseek/
            └── ...