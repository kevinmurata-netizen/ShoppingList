import { test, expect } from "@playwright/test";

async function seed(page) {
  const list = await (
    await page.request.post("/api/lists", { data: {} })
  ).json();
  await page.request.post(`/api/lists/${list.token}/pick`, {
    data: {
      items: [
        { name: "Milk", category: "Dairy & eggs" },
        { name: "Apples", category: "Fruit" },
        { name: "Birthday candles" },
      ],
    },
  });
  await page.goto(`/l/${list.token}`);
  await expect(
    page.getByRole("button", { name: "Edit Apples", exact: true }),
  ).toBeVisible();
  return `/api/lists/${list.token}`;
}
async function waitSynced(page) {
  await expect(
    page.getByText("Ready for offline shopping", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
const headings = (page) => page.locator(".category-heading");
async function editCategory(page, name, category) {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Category", { exact: true })
    .selectOption(category);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
async function reverseFruit(page, count = 4) {
  await page.getByRole("button", { name: "Aisle order", exact: true }).click();
  for (let index = 0; index < count; index++)
    await page
      .getByRole("button", { name: "Move Fruit down", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Save aisle order", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("optional categories group groceries, remember view choices, and use separate store aisle orders on a small phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const api = await seed(page);
  const group = page.getByRole("checkbox", {
    name: "Group by category",
    exact: true,
  });
  await expect(group).not.toBeChecked();
  await group.check();
  await expect(headings(page)).toHaveText([
    "Fruit1",
    "Dairy & eggs1",
    "Uncategorized1",
  ]);
  await expect(
    page
      .getByRole("region", { name: "Fruit items", exact: true })
      .getByRole("button", { name: "Edit Apples", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Aisle order", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Move Fruit up", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Move Pets down", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Sort A–Z", exact: true }).click();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Save aisle order", exact: true })
    .click();
  await expect(headings(page)).toHaveText([
    "Dairy & eggs1",
    "Fruit1",
    "Uncategorized1",
  ]);
  await page
    .getByRole("group", { name: "Filter by store", exact: true })
    .getByRole("button", { name: "Costco", exact: true })
    .click();
  await expect(headings(page)).toHaveText([
    "Fruit1",
    "Dairy & eggs1",
    "Uncategorized1",
  ]);
  await reverseFruit(page);
  await expect(headings(page)).toHaveText([
    "Dairy & eggs1",
    "Fruit1",
    "Uncategorized1",
  ]);
  await editCategory(page, "Birthday candles", "Household");
  await expect(headings(page)).toHaveText([
    "Dairy & eggs1",
    "Fruit1",
    "Household1",
  ]);
  await waitSynced(page);
  const saved = await (await page.request.get(api)).json();
  expect(saved.categoryOrders.Costco[4]).toBe("Fruit");
  expect(saved.categoryOrders["All stores"][0]).toBe("Beverages");
  await page.reload();
  await expect(group).toBeChecked();
  await group.uncheck();
  await expect(headings(page)).toHaveCount(0);
  await page.reload();
  await expect(group).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("catalog items carry categories and manual items can leave categories blank or select one", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose items", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Beverages", exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "Choose Coffee from Costco", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Fruit", exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "Choose Apples from Costco", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Add 2 items", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Item name", exact: true })
    .fill("Our snack");
  await page.getByRole("button", { name: "Item details", exact: true }).click();
  await page
    .getByLabel("Category for new item", { exact: true })
    .selectOption("Snacks");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Group by category", exact: true })
    .check();
  await expect(headings(page)).toHaveText(["Fruit1", "Snacks1", "Beverages1"]);
  await editCategory(page, "Apples", "");
  await expect(headings(page)).toHaveText([
    "Snacks1",
    "Beverages1",
    "Uncategorized1",
  ]);
  await page
    .getByRole("checkbox", { name: "Mark bought: Coffee", exact: true })
    .click();
  await page.getByRole("tab", { name: /Bought/ }).click();
  await expect(headings(page)).toHaveText(["Beverages1"]);
  await page
    .getByRole("checkbox", { name: "Mark not bought: Coffee", exact: true })
    .click();
  await page.getByRole("tab", { name: /To buy/ }).click();
  await expect(headings(page)).toHaveText([
    "Snacks1",
    "Beverages1",
    "Uncategorized1",
  ]);
});

test("offline categories and aisle orders survive reload, sync with family, and resolve competing order changes", async ({
  page,
  context,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await seed(page);
  await waitSynced(page);
  const family = await browser.newContext();
  try {
    const other = await family.newPage();
    await other.goto(page.url());
    await waitSynced(other);
    await other
      .getByRole("checkbox", { name: "Group by category", exact: true })
      .check();
    await context.setOffline(true);
    await editCategory(page, "Birthday candles", "Household");
    await reverseFruit(page);
    await page.reload();
    await expect(headings(page)).toHaveText([
      "Dairy & eggs1",
      "Fruit1",
      "Household1",
    ]);
    await expect(
      page.getByText("Offline · 2 changes saved on this phone", {
        exact: true,
      }),
    ).toBeVisible();
    await other.getByRole("button", { name: "Edit Milk", exact: true }).click();
    await other.getByRole("dialog").getByLabel(/Note/).fill("Whole milk");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await other
      .getByRole("button", { name: "Aisle order", exact: true })
      .click();
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Sort A–Z", exact: true })
      .click();
    await other
      .getByRole("button", { name: "Save aisle order", exact: true })
      .click();
    await waitSynced(other);
    await context.setOffline(false);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByText("Aisle order", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use my change", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await waitSynced(page);
    await expect(headings(other)).toHaveText([
      "Dairy & eggs1",
      "Fruit1",
      "Household1",
    ]);
    await expect(other.getByText("Whole milk", { exact: true })).toBeVisible();
    const saved = await (await page.request.get(api)).json();
    expect(
      saved.items.find((item) => item.name === "Birthday candles").category,
    ).toBe("Household");
    expect(saved.categoryOrders["All stores"][4]).toBe("Fruit");
    await page.screenshot({
      path: "test-results/aisles-phone.png",
      fullPage: true,
    });
  } finally {
    await family.close();
  }
});
