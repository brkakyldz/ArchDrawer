import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("takes PORT only as a whole decimal number from 1 to 65535, else 4317 (testing contract, Environment)", () => {
    expect(loadConfig({ PORT: "4405" }).port).toBe(4405);
    expect(loadConfig({ PORT: " 4405 " }).port).toBe(4405);
    expect(loadConfig({ PORT: "65535" }).port).toBe(65535);
    for (const bad of ["4405abc", "1e3", "80.5", "0", "70000", "", "-80", "0x50", "+80", "4 405"]) {
      expect(loadConfig({ PORT: bad }).port, bad).toBe(4317);
    }
    expect(loadConfig({}).port).toBe(4317);
  });
});
