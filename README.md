# Family Cart

A phone-friendly shopping list for a family that’s tired of keeping groceries in a text thread. Built with React, Node.js, SQLite, and WebSockets. Local development needs no external accounts. For free public hosting, optional Turso libSQL storage keeps lists safe on hosts with temporary filesystems.

## What it does

- Tap **Choose items** to search 116 grocery and household essentials, browse categories, and check several things to add together. Choose Costco, Walmart, Target, Safeway, or Other as you pick.
- Reuse **Your usuals**: recent family purchases keep their store, quantity, and notes, even after clearing Bought. These are shared with the family, not just saved on one phone.
- Tap the **star** beside an item to pin a family favorite. Favorites have their own tab, appear first in browsing results, retain their store and details, and can be pinned or unpinned offline.
- Review **Selected** before adding. Items already needed are marked, concurrent family picks do not create extra copies, and bought items can be added again with their details intact.
- Add an item as soon as you think of it. Costco is the initial default; your last selected store is remembered on your device.
- Organize by Costco, Walmart, Target, Safeway, or Other; search item names and notes.
- Add quantities, brands, pack sizes, and other notes. Edit or remove an item.
- Check off purchases, restore them, or clear all bought items with confirmation.
- Share one private link with your family. Changes appear live on connected devices, with automatic reconnection and periodic refresh as a fallback.
- Keep data through server restarts in SQLite.
- Shop offline after opening the family list online once on that phone. Check purchases off, add groceries, edit details, clear purchases, and change favorites. Updates are saved on the phone before the screen reports success and sync when the app is open again with a working connection.
- Install on iPhone or Android using the browser’s “Add to Home Screen” action. The installation manifest opens your current family link rather than an empty homepage.

The essentials catalog contains generic suggestions, not live store inventory. If a search doesn't find something, select **Add as a custom item**, or use the original quick-entry field. Edit an item on the shopping list to change its quantity, note, or store. Checking an item in the catalog selects it to buy; checking it on the shopping list marks it bought.

The app automatically adds history, favorites, sync receipts, and revision metadata to an existing database at startup; list links and shopping items remain in place. Up to 200 recent distinct purchases and 200 pinned favorites are supported. Purchases cleared before purchase history was installed cannot be recovered.

## Offline shopping and favorites

1. Open your actual family link online on each phone and wait for **Ready for offline shopping**. If you use a home-screen app, open that app online once too. An uncached link needs an initial connection before it can work offline. The ready indicator checks that the app shell is cached and the list is saved on that phone.
2. Open **Choose items** and tap a star to pin an essential, a usual, or a selected custom item. Open **Favorites** to find the family's pinned items; tap the star again to unpin.
3. Shop normally without reception. The offline banner shows how many changes are saved on this phone. Reloading or closing and reopening the app retains these changes in IndexedDB.
4. When you have reception again, leave the app open or reopen it. Pending changes sync automatically. A sleeping free host may need time to wake. Changes to unrelated fields merge; identical retries do not add groceries twice.
5. If the family changed the same field, choose **Review changes → Keep family update / Use my change**. Items removed by another family member are not automatically recreated. Dependent edits wait for earlier conflicts to be resolved; unrelated changes can still sync.

Unsent changes exist only on the phone where they were made. Do not clear browser/site data or uninstall the app before they finish syncing. Browser storage must be allowed and have space available. Clearing site data, private browsing cleanup, or browser/OS storage eviction can remove locally cached lists and unsent changes. The app reports storage failures rather than claiming a change was saved. Background syncing while the app is closed is not guaranteed; reopen it to finish syncing.

## Develop

Requires Node.js **24 or newer** and npm. Use the existing checkout; cloud tasks are already isolated and don’t need a Git worktree.

```sh
cd /workspace/ShoppingList
npm ci
npm run dev
```

The development command starts the API on port 3000 and Vite on port 5173. Vite forwards API and WebSocket traffic to the API. Open the Vite port in your local browser. Enter an item or tap **Share list** to create your private list. The browser remembers its link on that device.

Production-style run:

```sh
npm run build
NODE_ENV=production npm start
```

The single Node process serves the built app, API, and WebSocket connections on port 3000. `GET /api/health` checks database availability. `PORT` overrides the port, and `DATA_PATH` overrides the SQLite file location (default `.data/family-cart.sqlite`). `npm start` does not load a `.env` file; set variables through your host’s environment settings or export them in your shell.

To use a Turso **libSQL** database, set both `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Remote storage takes priority over `DATA_PATH`; no local database is created in this mode. Set `REQUIRE_REMOTE_DATABASE=true` on hosts with temporary disks so missing credentials cause startup to fail rather than fall back to local data. The server initializes tables automatically. Keep the token server-side, never in `VITE_…` variables or repository files. Use one app instance for live broadcasts.

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

The API tests run against native SQLite and a real libSQL client with isolated temporary databases. They cover item operations, family isolation, live updates, concurrent changes, restart persistence, sync receipts, stable IDs, favorite changes, and field-level conflicts. Storage/upgrade tests check rollback, fail-closed hosting configuration, and preservation of existing family databases. Browser tests use real IndexedDB and service workers to exercise offline reloads, reconnects, lost responses, duplicate additions, two tabs, conflicting and dependent edits, favorite sharing, blocked browser storage, and isolation of cached family links, in addition to the existing shopping workflows.

Browser tests use `/usr/bin/chromium` when available. Otherwise run `npx playwright install chromium`, or set `CHROMIUM_PATH` to your installed Chromium executable. Tests start a separate server on port 3100 and use a separate database, leaving development lists alone. Screenshots and failure traces go to the ignored `test-results/` directory.

## Let your family use it

For the free hosting route, follow [the exact Render + Turso setup steps](docs/FREE_HOSTING.md). The included `render.yaml` specifies Render's Free plan and prompts privately for the two Turso values. It does not provision an account or database by itself. Free-tier quotas and sleep/archiving policies apply.

The development cloud environment is not public app hosting. To use Family Cart on separate phones, deploy it to **one Node.js server with HTTPS, WebSocket support, and durable storage**. Use Turso for remote storage, or a persistent disk for SQLite-only deployments. A static-only host such as GitHub Pages cannot run the shared-list backend.

1. Save this project to your GitHub repository.
2. Choose a host that supports Node.js 24 or the included Dockerfile and WebSockets. SQLite-only deployments also need a persistent disk. No hosting account or paid service has been created by this project.
3. Use `npm ci --include=dev && npm run build` as the build command and `npm start` as the start command, or deploy the Dockerfile. The build needs development dependencies such as Vite even when `NODE_ENV=production`. For Turso, set the two credentials and `REQUIRE_REMOTE_DATABASE=true` as described above. For local SQLite, set `DATA_PATH` to a file on a writable persistent disk, for example `/app/data/family-cart.sqlite`.
4. Enable HTTPS through the host. Check `/api/health`, open the app, add an item, and send **Share list** to another phone. Check an item off on that phone and verify the first phone updates.
5. Restart the hosted app once and verify the list is retained before using it for real shopping.
6. On iPhone, open the family link in Safari → Share → Add to Home Screen. On Android, open it in Chrome → menu → Add to home screen / Install app. Share the list link before adding to the home screen so all devices open the same list.

For a Docker host:

```sh
docker compose up --build -d
```

The named `shopping-data` volume retains the database. Put the service behind an HTTPS reverse proxy that forwards WebSocket upgrades and preserves the original `Host` header. Back up the database with a SQLite-aware backup tool, or stop the app before copying the database and its WAL files. Don’t run multiple application instances against separate disks: they would have different data and live connections.

Optional container validation: run `docker build -t family-cart:test .`, then `npm run test:container`. It checks the actual non-root image’s frontend assets, API, live updates, database writes, and persistence through a restart. Test containers and volumes are removed afterward. `TEST_IMAGE` selects a different local image tag.

## Sharing and privacy

Each list has a random 192-bit private link. **Anyone with that complete link can read and edit the list.** There is no sign-in, member management, recovery email, or link revocation in this version. Keep the link within your family and save a copy. Losing every copy of the link means the app cannot recover the list for you. For individual access controls or revocable invitations, add account-based authentication before making those promises to users.

The app doesn’t use third-party analytics or external fonts. API responses aren't stored in the service worker's cache, and shared links aren't sent as referrers. The app shell is cached for offline startup. Private list snapshots, favorites, and unsent changes are stored in IndexedDB on each phone that opens that family link; local storage remembers the link and preferred store. Someone with access to that browser may see its cached list. Clearing browser data removes cached lists and unsent changes; a family link can recover the server's saved list, but not changes that never synced. Server receipts retain operation IDs and item-ID mappings to make retries idempotent.
