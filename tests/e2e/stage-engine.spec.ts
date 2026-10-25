import { expect, test } from "@playwright/test";
import { open } from "./helpers";

/**
 * The empty LinkedIn stage's engine and model (#44; ui contract, The LinkedIn flow). Defers to H183 for the
 * whole journey; this file keeps the steps H183 cannot reach: a run started on the overview turns the stage's
 * choice off, and Draw it sends the model chosen on the stage.
 */
test("the empty LinkedIn stage shows and changes the AI panel's engine and model, both ways, and Draw it uses them", async ({ page }) => {
  await open(page);
  await page.getByTestId("channel-tab-linkedin").click();
  const engine = page.getByTestId("stage-engine"), model = page.getByTestId("stage-model");
  await expect(page.getByTestId("linkedin-flow").getByTestId("stage-engine")).toBeVisible();
  expect(await engine.evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => [o.value, o.textContent]))).toContainEqual(["fixture", "Test engine (no AI)"]);
  expect(await model.evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value))).toEqual(["", "fixture-fast", "fixture-careful"]);
  for (const id of ["tool-component", "tool-connect", "tool-text", "share-button"]) await expect(page.getByTestId(id)).toBeDisabled();

  // Stage to panel and back.
  await model.selectOption("fixture-careful");
  await page.getByTestId("ai-button").click();
  await expect(page.getByTestId("ai-model")).toHaveValue("fixture-careful");
  await page.getByTestId("ai-model").selectOption("fixture-fast");
  await expect(model).toHaveValue("fixture-fast");

  // A run started on the overview turns the stage's choice off while it goes.
  await page.getByTestId("channel-tab-overview").click();
  await page.getByTestId("ai-input").fill("add Queue component [fixture:slow]");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-cancel")).toBeVisible();
  await page.getByTestId("channel-tab-linkedin").click();
  await expect(engine).toBeDisabled();
  await expect(model).toBeDisabled();
  await page.getByTestId("ai-cancel").click();
  await expect(page.getByTestId("ai-error")).toContainText("Cancelled");
  await expect(model).toBeEnabled();

  // Draw it sends the stage's engine and model, and asks the engine to read no file.
  await model.selectOption("fixture-careful");
  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/runs");
  await page.getByTestId("channel-draw").click();
  const body = (await sent).postDataJSON();
  expect(body).toMatchObject({ engine: "fixture", model: "fixture-careful", readCode: false });
});
