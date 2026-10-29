import { test, expect } from "@playwright/test";

test("family members share, filter, edit, buy and restore items live on mobile", async ({
  browser,
}) => {
  const first = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const alice = await first.newPage();
  const bob = await second.newPage();
  const errors = [];
  alice.on("pageerror", (err) => errors.push(err.message));
  try {
    await alice.goto("/");
    await expect(
      alice.getByRole("heading", { name: "Our family list" }),
    ).toBeVisible();
    await alice
      .getByRole("textbox", { name: "Item name", exact: true })
      .fill("Paper towels");
    await alice.getByRole("button", { name: "Item details" }).click();
    await alice.getByRole("button", { name: "Increase quantity" }).click();
    await alice
      .getByRole("textbox", { name: "Note for new item" })
      .fill("The big pack");
    await alice.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(
      alice.getByRole("button", { name: "Edit Paper towels", exact: true }),
    ).toBeVisible();
    await expect(alice).toHaveURL(/\/l\/[A-Za-z0-9_-]{32}$/);
    const familyUrl = alice.url();
    await bob.goto(familyUrl);
    await expect(
      bob.getByRole("button", { name: "Edit Paper towels", exact: true }),
    ).toBeVisible();
    await expect(bob.getByText("The big pack", { exact: true })).toBeVisible();
    await bob
      .getByRole("textbox", { name: "Item name", exact: true })
      .fill("Apples");
    await bob.getByLabel("Store for new item").selectOption("Safeway");
    await bob.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(
      alice.getByRole("button", { name: "Edit Apples", exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("group", { name: "Filter by store" })
      .getByRole("button", { name: "Costco" })
      .click();
    await expect(
      alice.getByRole("button", { name: "Edit Apples", exact: true }),
    ).toHaveCount(0);
    await alice
      .getByRole("group", { name: "Filter by store" })
      .getByRole("button", { name: "All stores" })
      .click();
    await alice
      .getByRole("checkbox", { name: "Mark bought: Paper towels" })
      .click();
    await expect(
      bob.getByRole("button", { name: "Edit Paper towels", exact: true }),
    ).toHaveCount(0);
    await bob.getByRole("tab", { name: /Bought/ }).click();
    await expect(
      bob.getByRole("checkbox", { name: "Mark not bought: Paper towels" }),
    ).toBeVisible();
    await bob
      .getByRole("checkbox", { name: "Mark not bought: Paper towels" })
      .click();
    await expect(
      alice.getByRole("button", { name: "Edit Paper towels", exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Edit Paper towels", exact: true })
      .click();
    await alice
      .getByRole("dialog")
      .getByLabel("Item name")
      .fill("Kirkland paper towels");
    await alice.getByRole("button", { name: "Save changes" }).click();
    await bob.getByRole("tab", { name: /To buy/ }).click();
    await expect(
      bob.getByRole("button", {
        name: "Edit Kirkland paper towels",
        exact: true,
      }),
    ).toBeVisible();
    await alice.reload();
    await expect(
      alice.getByRole("button", {
        name: "Edit Kirkland paper towels",
        exact: true,
      }),
    ).toBeVisible();
    await alice.getByRole("button", { name: "Share list" }).click();
    await expect(
      alice.getByRole("textbox", { name: "Family sharing link" }),
    ).toHaveValue(familyUrl);
    await alice.getByRole("button", { name: "Close dialog" }).click();
    await alice
      .getByRole("button", { name: "Search items", exact: true })
      .click();
    await alice
      .getByRole("textbox", { name: "Search items", exact: true })
      .fill("apples");
    await expect(
      alice.getByRole("button", { name: "Edit Apples", exact: true }),
    ).toBeVisible();
    await expect(
      alice.getByRole("button", {
        name: "Edit Kirkland paper towels",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("desktop layout, rename, deletion and clearing bought items", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
  for (const [name, store] of [
    ["Organic whole milk", "Costco"],
    ["Paper towels", "Costco"],
    ["Strawberries", "Safeway"],
    ["Dishwasher tablets", "Target"],
  ]) {
    await page
      .getByRole("textbox", { name: "Item name", exact: true })
      .fill(name);
    await page.getByLabel("Store for new item").selectOption(store);
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Edit ${name}`, exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: "test-results/desktop-populated.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-populated.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Rename your list" }).click();
  await page.getByLabel("List name", { exact: true }).fill("The weekend shop");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: "The weekend shop" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Mark bought: Organic whole milk" })
    .click();
  await page.getByRole("tab", { name: /Bought/ }).click();
  await page.getByRole("button", { name: "Clear bought", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear bought items", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Organic whole milk", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /To buy/ }).click();
  await expect(
    page.getByRole("button", { name: "Edit Paper towels", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Paper towels", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await page.getByRole("button", { name: "Yes, remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Paper towels", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a missing link has a recovery screen; failed saves preserve the entry", async ({
  page,
}) => {
  await page.goto("/l/invalid-family-link");
  await expect(
    page.getByRole("heading", { name: "Let’s find your family’s list." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start a new family list" }).click();
  await page
    .getByRole("textbox", { name: "Item name", exact: true })
    .fill("Coffee");
  await page.route("**/api/lists", (route) => route.abort());
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(
    page.getByRole("textbox", { name: "Item name", exact: true }),
  ).toHaveValue("Coffee");
});

test("home-screen assets are available and the saved family list opens offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  await page
    .getByRole("textbox", { name: "Item name", exact: true })
    .fill("Milk");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Offline · Your saved list is ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Item name", exact: true }),
  ).toBeEnabled();
  const cachedApis = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = (
      await Promise.all(
        keys.map(async (key) => (await caches.open(key)).keys()),
      )
    ).flat();
    return requests.filter((request) =>
      new URL(request.url).pathname.startsWith("/api/"),
    ).length;
  });
  expect(cachedApis).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("button", { name: "Edit Milk", exact: true }),
  ).toBeVisible();
});
