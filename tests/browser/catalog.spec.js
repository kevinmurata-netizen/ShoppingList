import { test, expect } from "@playwright/test";

test("choose groceries on a phone, search by category, review picks, and share them live", async ({
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
  try {
    const alice = await first.newPage();
    const bob = await second.newPage();
    await alice.goto("/");
    await alice
      .getByRole("button", { name: "Choose items", exact: true })
      .click();
    let dialog = alice.getByRole("dialog");
    await dialog
      .getByRole("checkbox", { name: "Choose Apples from Costco", exact: true })
      .check();
    await dialog
      .getByRole("checkbox", {
        name: "Choose Avocados from Costco",
        exact: true,
      })
      .check();
    await dialog
      .getByRole("searchbox", { name: "Search the grocery catalog" })
      .fill("kitchen rolls");
    await dialog
      .getByRole("checkbox", {
        name: "Choose Paper towels from Costco",
        exact: true,
      })
      .check();
    await dialog.getByRole("button", { name: "Clear catalog search" }).click();
    await dialog
      .getByRole("group", { name: "Grocery categories" })
      .getByRole("button", { name: "Dairy & eggs", exact: true })
      .click();
    await dialog
      .getByRole("checkbox", { name: "Choose Milk from Costco", exact: true })
      .check();
    await dialog.getByLabel("Store for catalog items").selectOption("Target");
    await dialog
      .getByRole("checkbox", { name: "Choose Milk from Target", exact: true })
      .check();
    await dialog.getByRole("tab", { name: /Selected/ }).click();
    await expect(dialog.getByRole("checkbox")).toHaveCount(5);
    await dialog
      .getByRole("checkbox", {
        name: "Choose Avocados from Costco",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Choose Avocados from Costco",
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Add 4 items", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      alice.getByRole("button", { name: "Edit Paper towels", exact: true }),
    ).toBeVisible();
    await expect(
      alice.getByRole("button", { name: "Edit Milk", exact: true }),
    ).toHaveCount(2);
    await bob.goto(alice.url());
    await expect(
      bob.getByRole("button", { name: "Edit Apples", exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Choose items", exact: true })
      .click();
    dialog = alice.getByRole("dialog");
    await dialog.getByLabel("Store for catalog items").selectOption("Costco");
    await expect(
      dialog.getByRole("checkbox", {
        name: "Choose Apples from Costco",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Choose Apples from Costco",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog
      .getByRole("searchbox", { name: "Search the grocery catalog" })
      .fill("coffee");
    await dialog
      .getByRole("checkbox", { name: "Choose Coffee from Costco", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "Add 1 item", exact: true })
      .click();
    await expect(
      bob.getByRole("button", { name: "Edit Coffee", exact: true }),
    ).toBeVisible();
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await first.close();
    await second.close();
  }
});

test("family usuals keep quantities and notes after bought items are cleared and reused", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Item name", exact: true })
    .fill("Our favorite granola");
  await page.getByRole("button", { name: "Quantity & note" }).click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page
    .getByRole("textbox", { name: "Note for new item" })
    .fill("Nut free, family size");
  await page.getByLabel("Store for new item").selectOption("Walmart");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Mark bought: Our favorite granola" })
    .click();
  await page.getByRole("tab", { name: /Bought/ }).click();
  await page.getByRole("button", { name: "Clear bought", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear bought items", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Choose items", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /Your usuals/ }).click();
  await expect(
    dialog.getByText("Nut free, family size", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("×2", { exact: true })).toBeVisible();
  await dialog
    .getByRole("checkbox", { name: "Choose Our favorite granola from Walmart" })
    .check();
  await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Edit Our favorite granola",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Nut free, family size", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("×2", { exact: true })).toBeVisible();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(page.url());
    await other
      .getByRole("button", { name: "Choose items", exact: true })
      .click();
    await other
      .getByRole("dialog")
      .getByRole("tab", { name: /Your usuals/ })
      .click();
    await expect(
      other.getByRole("checkbox", {
        name: "Choose Our favorite granola from Walmart",
      }),
    ).toBeDisabled();
  } finally {
    await otherContext.close();
  }
});

test("failed additions preserve checkbox selections; custom items and a small phone layout work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Choose items", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("searchbox", { name: "Search the grocery catalog" })
    .fill("Birthday candles");
  await dialog
    .getByRole("button", {
      name: "Add “Birthday candles” as a custom item",
      exact: true,
    })
    .click();
  await page.route("**/api/lists/*/pick", (route) => route.abort());
  await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Check your connection",
  );
  await dialog.getByRole("tab", { name: /Selected/ }).click();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Choose Birthday candles from Costco",
    }),
  ).toBeChecked();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.unroute("**/api/lists/*/pick");
  await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Birthday candles", exact: true }),
  ).toBeVisible();
});
