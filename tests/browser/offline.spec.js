import { test, expect } from "@playwright/test";

async function add(page, name) {
  await page
    .getByRole("textbox", { name: "Item name", exact: true })
    .fill(name);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${name}`, exact: true }),
  ).toBeVisible();
}
async function waitSynced(page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const db = await new Promise((resolve) => {
            const request = indexedDB.open("family-cart-offline", 1);
            request.onsuccess = () => resolve(request.result);
          });
          const count = await new Promise((resolve) => {
            const req = db
              .transaction("operations")
              .objectStore("operations")
              .count();
            req.onsuccess = () => resolve(req.result);
          });
          db.close();
          return count;
        }),
      { timeout: 15000 },
    )
    .toBe(0);
}
async function prepare(page) {
  await page.goto("/");
  await add(page, "Milk");
  await waitSynced(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect(
    page.getByText("Ready for offline shopping", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
  const manifest = await page.evaluate(async () =>
    (await fetch(document.querySelector('link[rel="manifest"]').href)).json(),
  );
  expect(manifest.start_url).toBe(new URL(page.url()).pathname);
}
async function reconnect(context, page) {
  await context.setOffline(false);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

test("offline purchases and new groceries survive a reload and sync to the family without duplicates", async ({
  page,
  context,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const familyUrl = page.url();
  const family = await browser.newContext();
  try {
    const other = await family.newPage();
    await other.goto(familyUrl);
    await expect(
      other.getByRole("button", { name: "Edit Milk", exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("checkbox", { name: "Mark bought: Milk" }).click();
    await add(page, "Offline bananas");
    await page.reload();
    await expect(
      page.getByText(/Offline · 2 changes saved on this phone/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit Offline bananas", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Bought/ }).click();
    await expect(
      page.getByRole("checkbox", { name: "Mark not bought: Milk" }),
    ).toBeVisible();
    await add(other, "Family apples");
    await reconnect(context, page);
    await waitSynced(page);
    await other.getByRole("tab", { name: /Bought/ }).click();
    await expect(
      other.getByRole("checkbox", { name: "Mark not bought: Milk" }),
    ).toBeVisible();
    await other.getByRole("tab", { name: /To buy/ }).click();
    await expect(
      other.getByRole("button", { name: "Edit Offline bananas", exact: true }),
    ).toHaveCount(1);
    await expect(
      other.getByRole("button", { name: "Edit Family apples", exact: true }),
    ).toBeVisible();
    await page.reload();
    await waitSynced(page);
    const saved = await (
      await page.request.get(
        new URL(page.url()).pathname.replace("/l/", "/api/lists/"),
      )
    ).json();
    expect(
      saved.items.filter((item) => item.name === "Offline bananas"),
    ).toHaveLength(1);
  } finally {
    await family.close();
  }
});

test("pinned favorites are shared with the family, work offline, and can be unpinned", async ({
  page,
  context,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const url = page.url();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Choose items", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("searchbox", { name: "Search the grocery catalog" })
    .fill("milk");
  await dialog
    .getByRole("button", { name: "Pin Milk from Costco", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Unpin Milk from Costco", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "Choose items", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: /Favorites/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    dialog.getByRole("button", { name: "Unpin Milk from Costco", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await reconnect(context, page);
  await waitSynced(page);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(url);
    await other
      .getByRole("button", { name: "Choose items", exact: true })
      .click();
    const otherDialog = other.getByRole("dialog");
    await expect(
      otherDialog.getByRole("button", {
        name: "Unpin Milk from Costco",
        exact: true,
      }),
    ).toBeVisible();
    await otherDialog
      .getByRole("button", { name: "Unpin Milk from Costco", exact: true })
      .click();
    await expect(
      otherDialog.getByRole("checkbox", { name: "Choose Milk from Costco" }),
    ).toHaveCount(0);
    await waitSynced(other);
  } finally {
    await otherContext.close();
  }
});

test("offline editing preserves a different field changed by the family", async ({
  page,
  context,
  browser,
}) => {
  await prepare(page);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(page.url());
    await expect(
      other.getByRole("button", { name: "Edit Milk", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await context.setOffline(true);
    await other.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await other.getByRole("dialog").getByLabel("Quantity").fill("3");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await waitSynced(other);
    await page.getByRole("dialog").getByLabel(/Note/).fill("Organic please");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await reconnect(context, page);
    await waitSynced(page);
    await expect(
      other.getByText("Organic please", { exact: true }),
    ).toBeVisible();
    await expect(other.getByText("×3", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review changes" }),
    ).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test("same-field conflicts survive reload and require an explicit choice", async ({
  page,
  context,
  browser,
}) => {
  await prepare(page);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(page.url());
    await expect(
      other.getByRole("button", { name: "Edit Milk", exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/Note/).fill("My brand");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await other.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await other.getByRole("dialog").getByLabel(/Note/).fill("Family brand");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await waitSynced(other);
    await reconnect(context, page);
    await expect(
      page.getByRole("button", { name: "Review changes" }),
    ).toBeVisible({ timeout: 15000 });
    await page.reload();
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(
      page.getByRole("dialog").getByText("My brand", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Family brand", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use my change", exact: true })
      .click();
    await waitSynced(page);
    await expect(other.getByText("My brand", { exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("a lost server response is retried safely after a reload", async ({
  page,
}) => {
  await prepare(page);
  let dropped = false;
  await page.route("**/api/lists/*/sync", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await add(page, "One pack of rice");
  await expect.poll(() => dropped).toBe(true);
  await page.reload();
  await waitSynced(page);
  const data = await (
    await page.request.get(
      new URL(page.url()).pathname.replace("/l/", "/api/lists/"),
    )
  ).json();
  expect(
    data.items.filter((item) => item.name === "One pack of rice"),
  ).toHaveLength(1);
});

test("two tabs share the offline queue and sync each change once", async ({
  page,
  context,
}) => {
  await prepare(page);
  await add(page, "Eggs");
  await waitSynced(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("button", { name: "Edit Eggs", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("checkbox", { name: "Mark bought: Milk" }).click();
  await second.getByRole("checkbox", { name: "Mark bought: Eggs" }).click();
  await reconnect(context, page);
  await waitSynced(page);
  const data = await (
    await page.request.get(
      new URL(page.url()).pathname.replace("/l/", "/api/lists/"),
    )
  ).json();
  expect(data.items).toHaveLength(2);
  expect(data.items.every((item) => item.bought)).toBe(true);
});

for (const choice of ["mine", "family"])
  test(`dependent offline edits wait for review and respect the ${choice} choice`, async ({
    page,
    context,
    browser,
  }) => {
    await prepare(page);
    const otherContext = await browser.newContext();
    try {
      const other = await otherContext.newPage();
      await other.goto(page.url());
      await expect(
        other.getByRole("button", { name: "Edit Milk", exact: true }),
      ).toBeVisible();
      await context.setOffline(true);
      for (const note of ["First offline brand", "Last offline brand"]) {
        await page
          .getByRole("button", { name: "Edit Milk", exact: true })
          .click();
        await page.getByRole("dialog").getByLabel(/Note/).fill(note);
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
      }
      await other
        .getByRole("button", { name: "Edit Milk", exact: true })
        .click();
      await other.getByRole("dialog").getByLabel(/Note/).fill("Family brand");
      await other
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await waitSynced(other);
      await reconnect(context, page);
      await page.getByRole("button", { name: "Review changes" }).click();
      if (choice === "mine") {
        await page
          .getByRole("button", { name: "Use my change", exact: true })
          .click();
        await waitSynced(page);
        await expect(
          other.getByText("Last offline brand", { exact: true }),
        ).toBeVisible();
      } else {
        await page
          .getByRole("button", { name: "Keep family update", exact: true })
          .click();
        await expect(
          page
            .getByRole("dialog")
            .getByText("An earlier offline change was discarded.", {
              exact: false,
            }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Keep family update", exact: true })
          .click();
        await waitSynced(page);
        await expect(
          other.getByText("Family brand", { exact: true }),
        ).toBeVisible();
      }
    } finally {
      await otherContext.close();
    }
  });

test("offline additions merge with a matching family addition and remap later check-offs", async ({
  page,
  context,
  browser,
}) => {
  await prepare(page);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(page.url());
    await expect(
      other.getByRole("button", { name: "Edit Milk", exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await add(page, "Rice");
    await page.getByRole("checkbox", { name: "Mark bought: Rice" }).click();
    await add(other, "Rice");
    await other.getByRole("button", { name: "Edit Rice", exact: true }).click();
    await other.getByRole("dialog").getByLabel("Quantity").fill("2");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await waitSynced(other);
    await reconnect(context, page);
    await waitSynced(page);
    await other.getByRole("tab", { name: /Bought/ }).click();
    await expect(
      other.getByRole("checkbox", { name: "Mark not bought: Rice" }),
    ).toBeVisible();
    await expect(other.getByText("×2", { exact: true })).toBeVisible();
    const saved = await (
      await page.request.get(
        new URL(page.url()).pathname.replace("/l/", "/api/lists/"),
      )
    ).json();
    expect(saved.items.filter((item) => item.name === "Rice")).toHaveLength(1);
  } finally {
    await otherContext.close();
  }
});

test("an uncached family link opened offline never shows another cached family list", async ({
  page,
  context,
}) => {
  await prepare(page);
  const original = page.url();
  await context.setOffline(true);
  await page.goto("/l/" + "b".repeat(32));
  await expect(
    page.getByText(
      "Open this family link online once to save it for offline shopping.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toHaveCount(0);
  await page.goto(original);
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
});

test("blocked browser storage cannot falsely report a durable offline edit", async ({
  page,
}) => {
  await prepare(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        return {
          open() {
            throw new DOMException("Storage blocked", "SecurityError");
          },
        };
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Changes couldn't be saved on this phone", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Mark bought: Milk" }),
  ).toBeDisabled();
  const saved = await (
    await page.request.get(
      new URL(page.url()).pathname.replace("/l/", "/api/lists/"),
    )
  ).json();
  expect(saved.items[0].bought).toBe(false);
});
