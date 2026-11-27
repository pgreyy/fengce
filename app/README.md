# app

The site at [getfengce.vercel.app](https://getfengce.vercel.app): static pages (React and Vite) that read X Layer straight
from the browser, plus a small read-only HTTP API (`api-src/`). Pages live in [`src/pages/`](src/pages/) (home, limits, try,
tilt-shield, wallet, agents, docs, install, start); shared code in [`src/fengce/`](src/fengce/) (install calldata in
`engine.ts`, wallet connection in `wallet.ts`, activity from chain logs in `chainActivity.ts`).

```sh
npm ci && npm run build      # dist/, the same files that go to Vercel and TapeOut DeWeb
npm run snapshot             # refresh public/events-snapshot.json (read-only RPC calls)
```
