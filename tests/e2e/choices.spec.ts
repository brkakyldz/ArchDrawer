import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { asV3, open, shop } from "./helpers";

/**
 * The editor shows one choice of a format 4 file (ui contract, Routes; Choices and the views panel). The held-out
 * H199, H200, H201 and H208 observe it too but reach these steps only past the views panel (#185); this file
 * keeps the address, `data-choice` and an edit landing in the current choice alone (review 510f7bc-2).
 */
function twoChoices(): Record<string, any> {
  const f = asV3(shop()) as Record<string, any>;
  const second = structuredClone(f.choices[0]);
  second.id = "server"; second.title = "The server side"; second.kind = "section";
  second.channels.overview.views[0].id = "server-overview";
  // The two choices differ only in the second's first label, so an edit shows which one it reached.
  f.choices = [f.choices[0], second];
  return f;
}

test("the address picks the choice, an edit changes that choice alone, and an unknown choice opens the first", async ({ page }) => {
  const { id, path } = await open(page, twoChoices());
  const editor = page.getByTestId("editor");
  await expect(editor).toHaveAttribute("data-choice", "system");
  const firstLabel = JSON.parse(readFileSync(path, "utf8")).choices[0].facts.components[0].label as string;
  const part = JSON.parse(readFileSync(path, "utf8")).choices[1].channels.overview.views[0].nodes[0].id as string;

  await page.goto(`/d/${id}?choice=server`);
  await expect(editor).toHaveAttribute("data-choice", "server");
  await expect(editor).toHaveAttribute("data-view", "server-overview");
  await page.getByTestId(`node-${part}`).getByTestId("node-label").dblclick();
  await page.getByTestId("node-label-input").fill("Edited in server");
  await page.getByTestId("node-label-input").press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect.poll(() => JSON.parse(readFileSync(path, "utf8")).choices[1].facts.components.some((c: { label: string }) => c.label === "Edited in server")).toBe(true);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved.choices[0].facts.components[0].label).toBe(firstLabel);
  expect(saved.choices[0].facts.components.some((c: { label: string }) => c.label === "Edited in server")).toBe(false);

  // An older link with only a view opens the choice that holds it; an unknown choice opens the first's overview.
  await page.goto(`/d/${id}?view=server-overview`);
  await expect(editor).toHaveAttribute("data-choice", "server");
  await page.goto(`/d/${id}?choice=nope&channel=linkedin`);
  await expect(editor).toHaveAttribute("data-choice", "system");
  await expect(editor).toHaveAttribute("data-channel", "overview");
  // Going to a channel keeps the choice in the address.
  await page.goto(`/d/${id}?choice=server`);
  await page.getByTestId("channel-tab-readme").click();
  await expect(page).toHaveURL(/\?choice=server&channel=readme$/);
});
