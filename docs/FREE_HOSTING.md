# Host Family Cart using free plans

Use **Render Free** for the app and a **Turso Free libSQL database** for the lists. Render provides the public HTTPS address and WebSocket connections; Turso keeps the data independently of Render's temporary filesystem. The included `render.yaml` configures a single free Node web service and requires remote storage, so missing database settings cannot silently put family data on a temporary disk.

No hosting account has been created, and the live hosted connection needs your account setup below. Choose the plans explicitly labeled **Free / $0**. Free plans have quotas and can change; if a screen requires a paid plan or an upgrade, stop before accepting it. A paid domain is unnecessary: use the supplied `onrender.com` address.

## 1. Put the project on GitHub

1. Download the source ZIP supplied in the chat and unzip it on a computer. You should have a `family-cart` folder.
2. Open [kevinmurata-netizen/ShoppingList](https://github.com/kevinmurata-netizen/ShoppingList) and sign in.
3. On the empty repository page, click **uploading an existing file**. If the repository already has a file, use **Add file → Upload files**.
4. Open the extracted `family-cart` folder and drag **its contents** into the upload area. Upload the files and subfolders, not the ZIP itself or an extra outer `family-cart` folder. Include the hidden `.gitignore` and `.dockerignore` files if your file browser shows them. They are included in the ZIP; the app can still deploy if the uploader hides these two files.
5. Commit the files to **main**, with a message such as `Add Family Cart app`.
6. Confirm `package.json`, `render.yaml`, and the `server`, `src`, and `public` folders appear at the repository's top level. You can leave the repository private.

## 2. Create the free database

1. Open [Turso](https://turso.tech/) and sign up or sign in. Choose its **Free** plan.
2. Create a database named **family-cart**. If an engine choice is shown, select **libSQL**. This app's driver is for libSQL, rather than the newer Turso engine.
3. Choose a US West region if offered; the app's Render configuration uses Oregon. Another available region also works.
4. Open that database's connection/credentials section. Copy its **database URL** (usually `libsql://…turso.io`).
5. Generate a **database auth token with read and write access**. Use a database token, not an organization API token and not a read-only token. Keep it available to paste into Render's private environment field in the next section. Do not put it in a GitHub file, a browser-facing `VITE_…` variable, or this chat.

If the dashboard doesn't offer libSQL creation or database tokens, the [official Turso CLI](https://docs.turso.tech/quickstart) provides these exact commands after installation:

```sh
turso auth login
turso db create family-cart
turso db show family-cart --url
turso db tokens create family-cart
```

Omitting `--tursodb` selects libSQL. The last command displays a secret; copy its output only into Render's token field. Turso's CLI login opens your browser for account authorization. The app creates its own database tables at first startup; no SQL needs to be entered manually.

## 3. Deploy on Render

1. Open [Render's dashboard](https://dashboard.render.com/) and sign up or sign in, using the free workspace option.
2. Connect GitHub when prompted. Grant Render access to **ShoppingList**; access to every repository is unnecessary.
3. Choose **New + → Blueprint**.
4. Select **kevinmurata-netizen/ShoppingList** and branch **main**. Render reads the `render.yaml` file already in the project.
5. Name the Blueprint **family-cart**, or another available name.
6. Enter the two prompted environment values:

   | Name | Value |
   | --- | --- |
   | `TURSO_DATABASE_URL` | The database URL copied from Turso |
   | `TURSO_AUTH_TOKEN` | The read/write database auth token copied from Turso |

7. Review the proposed resources: **one web service on the Free plan**. Do not add a Render database, persistent disk, paid instance, custom domain, or extra service. The file already sets Node 24, production mode, build/start commands, and a health check.
8. Click the deploy/apply button. Wait for the web service to report **Live**. The first dependency installation and build can take several minutes.
9. Open the web service's HTTPS `…onrender.com` address shown by Render. The exact hostname is assigned by Render; it is not included in this guide.

If you accidentally use **New Web Service** instead of Blueprint, the equivalent manual settings are: Node runtime, `main` branch, repository root as Root Directory, Free instance, build command `npm ci --include=dev --no-audit --no-fund && npm run build`, start command `npm start`, and health check `/api/health`. Set `NODE_VERSION=24`, `NODE_ENV=production`, `REQUIRE_REMOTE_DATABASE=true`, plus the two Turso values above. Do not deploy using SQLite-only settings on Render Free.

## 4. Check the hosted app before using it

1. Open the public app and add `Test milk`.
2. Tap **Share list**, copy the family link, and open it on a second phone or in a private browser window.
3. Confirm `Test milk` appears there. Check it off on the second device and verify it moves to **Bought** on the first device without a manual refresh.
4. In Render, use the web service's restart action. After it is Live again, reopen the same family link and check that `Test milk` is still under Bought. This verifies the real Turso connection and persistence in your account.
5. Clear the test item and add your actual groceries.

The code has been tested locally, including its libSQL storage adapter. A successful local test is not proof that your hosted credentials and network access work; finish the checks above on the public address.

## 5. Share it and add it to your phones

1. Send the **Share list** link to the family group text. Send that complete `/l/…` link, rather than just the app's homepage, so everyone opens the same list.
2. On iPhone: open that link in **Safari → Share → Add to Home Screen → Add**.
3. On Android: open that link in **Chrome → ⋮ → Add to home screen / Install app**.
4. Save the family link somewhere you can find again. Anyone with it can view and edit the list; there are no individual accounts or email-based link recovery.

## What to expect on free plans

- Render's free service can sleep after inactivity. The first visit can take roughly a minute to wake it. Wait for the page to finish loading before adding items. Ordinary live updates work once it is running.
- Free compute and database quotas apply. Stay on the Free plans; do not enable paid usage or upgrades if your goal is a strict $0 setup. See [Render Free](https://render.com/docs/free) and [Turso pricing](https://turso.tech/pricing) for the terms shown to your account.
- Turso documents archiving inactive free databases. If you haven't used the list for an extended period and it stops connecting, check the database's status in Turso and reactivate it if needed.
- There is no uptime guarantee. This is suitable for a low-traffic family app, with a possible cold-start wait, rather than an always-awake paid server.

## If deployment fails

- **Repository/file not found:** Check that Render can access ShoppingList, uses `main`, and sees `render.yaml` and `package.json` at the root.
- **`vite: not found`:** The build must install development dependencies even in production mode. Confirm the Build Command is `npm ci --include=dev --no-audit --no-fund && npm run build`. For an existing Blueprint, sync the latest `main` configuration before redeploying.
- **Storage startup failed:** Check the two Turso values in Render's Environment settings, the database engine (libSQL), token permissions/expiration, and the database's active status. Save the correction and redeploy/restart. Keep token values out of shared logs and screenshots.
- **List missing after restart:** Confirm `REQUIRE_REMOTE_DATABASE=true` and both Turso values are present. A correct deployment refuses to start without remote storage. Make sure you are opening the same family link.
- **Family member sees an empty list:** Send the complete family `/l/…` link again. Starting from the homepage on a new device can create a different list.
- **Changes don't appear live:** Wait for Render to wake, check that the list shows its live connection, and reload once. Use a single service instance; live connection broadcasts are held by that process.
