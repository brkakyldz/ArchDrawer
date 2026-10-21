import { describe, expect, it } from "vitest";
import { READ_LIMITS, ReadAnswerError, repairRead } from "./read";

// The read's repair (diagram contract, Read answers): one warning per change, relations r1, r2, …

const comp = (id: string, extra: object = {}) => ({ id, label: id.toUpperCase(), kind: "service", sub: "", description: `${id} does work.`, within: null, evidence: [{ file: "src/a.ts", lines: null }], ...extra });
const rel = (from: string, to: string, extra: object = {}) => ({ from, to, label: "", style: "call", both: false, evidence: [{ file: "src/a.ts", lines: [1, 2] }], ...extra });

describe("the read's repair", () => {
  it("leaves a clean answer as it is, names relations r1, r2 … and gives only a mechanism its within", () => {
    const r = repairRead({ components: [comp("app"), comp("agent"), comp("loop", { within: "agent" })], relations: [rel("app", "agent"), rel("agent", "loop")], limits: [{ id: "turns", on: "agent", text: "Stops after 12 turns", evidence: [] }] });
    expect(r.warnings).toEqual([]);
    expect(r.facts.relations.map((x) => [x.id, x.from, x.to])).toEqual([["r1", "app", "agent"], ["r2", "agent", "loop"]]);
    expect(r.facts.components.map((c) => c.within)).toEqual([undefined, undefined, "agent"]);
    expect(r.facts.components[0]).toMatchObject({ files: [], items: [] });
  });

  it("cleans and dedupes ids, and relations follow a renamed id to its first component", () => {
    const r = repairRead({ components: [comp("api gateway"), comp("db"), comp("db")], relations: [rel("api gateway", "db")], limits: [] });
    expect(r.facts.components.map((c) => c.id)).toEqual(["api-gateway", "db", "db-2"]);
    expect(r.facts.relations[0]).toMatchObject({ from: "api-gateway", to: "db" });
    expect(r.warnings).toEqual(['Renamed the component id "api gateway" to "api-gateway": ids use letters, digits, - and _', 'Renamed the duplicate id "db" to "db-2"']);
  });

  it("repairs kinds, styles, empty and long texts, one warning each", () => {
    const r = repairRead({ components: [comp("a", { kind: "robot", label: "", description: "" }), comp("b", { label: "x".repeat(60) })], relations: [rel("a", "b", { style: "magic" })], limits: [] });
    const [a, b] = r.facts.components;
    expect([a.kind, a.label, a.description, b.label.length, b.label.endsWith("…"), r.facts.relations[0].style]).toEqual(["service", "a", "No description yet.", 48, true, "call"]);
    expect(r.warnings).toHaveLength(5);
  });

  it("clears a within that names nothing, the fact itself or a mechanism", () => {
    const r = repairRead({ components: [comp("agent"), comp("loop", { within: "agent" }), comp("step", { within: "loop" }), comp("self", { within: "self" }), comp("lost", { within: "ghost" })], relations: [], limits: [] });
    expect(r.facts.components.map((c) => [c.id, c.within ?? null])).toEqual([["agent", null], ["loop", "agent"], ["step", null], ["self", null], ["lost", null]]);
    expect(r.warnings).toHaveLength(3);
  });

  it("drops a relation to itself, to an unknown id or a second one on a pair, and joins a reverse pair", () => {
    const r = repairRead({ components: [comp("a"), comp("b")], relations: [rel("a", "b"), rel("a", "a"), rel("a", "ghost"), rel("a", "b"), rel("b", "a")], limits: [] });
    expect(r.facts.relations.map((x) => [x.id, x.from, x.to, x.both])).toEqual([["r1", "a", "b", true]]);
    expect(r.warnings).toHaveLength(4);
  });

  it("cuts components and limits over the limit, the last first, and drops a limit on no component", () => {
    const many = Array.from({ length: READ_LIMITS.components + 3 }, (_, i) => comp(`c${i}`));
    const lims = Array.from({ length: READ_LIMITS.limits + 1 }, (_, i) => ({ id: `l${i}`, on: "c0", text: "Bounded", evidence: [] }));
    const r = repairRead({ components: many, relations: [], limits: [...lims.slice(0, 2), { id: "x", on: "ghost", text: "Lost", evidence: [] }] });
    expect(r.facts.components).toHaveLength(READ_LIMITS.components);
    expect(r.facts.components.at(-1)!.id).toBe(`c${READ_LIMITS.components - 1}`);
    expect(r.facts.limits.map((l) => l.id)).toEqual(["l0", "l1"]);
    expect(repairRead({ components: [comp("c0")], relations: [], limits: lims }).facts.limits).toHaveLength(READ_LIMITS.limits);
  });

  it("refuses an answer that is not a facts answer at all", () => {
    expect(() => repairRead("no facts")).toThrow(ReadAnswerError);
    expect(() => repairRead({ relations: [] })).toThrow(/no components list/);
  });
});
