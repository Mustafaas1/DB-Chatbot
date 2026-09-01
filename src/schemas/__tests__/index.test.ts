import { describe, expect, it } from "vitest";
import {
  Action, Evidence, GoalNode, Plan,
  cocuklariGetir, dogrulanmisMi, onayZorunlulugunuUygula, planSkoru,
} from "../index";

const kanit = { source: "db" as const, query: "SELECT 1", value: 59, confidence: 0.95 };

describe("Evidence", () => {
  it("gecerli kanit kabul edilir", () => {
    expect(Evidence.parse(kanit).source).toBe("db");
  });

  it("bilinmeyen kaynak reddedilir", () => {
    expect(() => Evidence.parse({ ...kanit, source: "tahmin" })).toThrow();
  });

  it("confidence 0-1 disina cikamaz", () => {
    expect(() => Evidence.parse({ ...kanit, confidence: 1.5 })).toThrow();
    expect(() => Evidence.parse({ ...kanit, confidence: -0.1 })).toThrow();
  });

  it("llm-inference sorgu tasimayabilir", () => {
    expect(Evidence.parse({ source: "llm-inference", value: 10, confidence: 0.3 }).query)
      .toBeUndefined();
  });
});

describe("GoalNode", () => {
  const dugum = {
    id: "n1", parentId: null, statement: "Destek yükünü azaltmak",
    type: "goal" as const, evidence: [], children: [],
  };

  it("kok dugumun parentId'si null olabilir", () => {
    expect(GoalNode.parse(dugum).parentId).toBeNull();
  });

  it("bilinmeyen tur reddedilir", () => {
    expect(() => GoalNode.parse({ ...dugum, type: "surucu" })).toThrow();
  });

  it("bes tur da kabul edilir", () => {
    for (const t of ["goal", "metric", "lever", "resource", "action"]) {
      expect(GoalNode.parse({ ...dugum, type: t }).type).toBe(t);
    }
  });

  it("cocuklar ID listesidir, ic ice nesne degil", () => {
    expect(GoalNode.parse({ ...dugum, children: ["n2", "n3"] }).children).toEqual(["n2", "n3"]);
    expect(() => GoalNode.parse({ ...dugum, children: [{ id: "n2" }] })).toThrow();
  });

  it("bos ifade reddedilir", () => {
    expect(() => GoalNode.parse({ ...dugum, statement: "" })).toThrow();
  });
});

describe("dogrulanmisMi", () => {
  const temel = { id: "n1", parentId: null, statement: "x", type: "metric" as const, children: [] };

  it("db kaniti varsa dogrulanmis", () => {
    expect(dogrulanmisMi(GoalNode.parse({ ...temel, evidence: [kanit] }))).toBe(true);
  });

  it("YALNIZCA llm-inference varsa dogrulanmamis", () => {
    expect(dogrulanmisMi(GoalNode.parse({
      ...temel, evidence: [{ source: "llm-inference", value: 1, confidence: 0.4 }],
    }))).toBe(false);
  });

  it("kanit yoksa dogrulanmamis", () => {
    expect(dogrulanmisMi(GoalNode.parse({ ...temel, evidence: [] }))).toBe(false);
  });
});

describe("Action ve onay zorunlulugu", () => {
  const aksiyon = {
    id: "a1", title: "Bileti ata", tool: "bilet_ata", params: { biletNo: "X" },
    risk: "low" as const, reversible: true, requiresApproval: false,
    dryRunSupported: true, expectedOutcome: "atanir",
  };

  it("geri ALINAMAYAN aksiyon onay ister", () => {
    const a = onayZorunlulugunuUygula(Action.parse({ ...aksiyon, reversible: false }));
    expect(a.requiresApproval).toBe(true);
  });

  it("YUKSEK riskli aksiyon onay ister", () => {
    const a = onayZorunlulugunuUygula(Action.parse({ ...aksiyon, risk: "high" }));
    expect(a.requiresApproval).toBe(true);
  });

  it("dusuk riskli ve geri alinabilir aksiyon zorlanmaz", () => {
    expect(onayZorunlulugunuUygula(Action.parse(aksiyon)).requiresApproval).toBe(false);
  });

  it("rollback opsiyoneldir ama sekli sabittir", () => {
    expect(() => Action.parse({ ...aksiyon, rollback: { params: {} } })).toThrow();
    expect(Action.parse({ ...aksiyon, rollback: { tool: "bilet_ata", params: {} } }).rollback?.tool)
      .toBe("bilet_ata");
  });
});

describe("Plan", () => {
  const plan = {
    id: "p1", agent: "experience", title: "Beklemedeki biletlere sahip ata",
    impact: 4, effort: 2, confidence: 0.8,
  };

  it("skor koddan hesaplanir: etki x guven / caba", () => {
    expect(planSkoru({ impact: 4, effort: 2, confidence: 0.8 })).toBe(1.6);
    expect(planSkoru({ impact: 5, effort: 1, confidence: 1 })).toBe(5);
  });

  it("aralik disi impact reddedilir", () => {
    expect(() => Plan.parse({ ...plan, impact: 6 })).toThrow();
    expect(() => Plan.parse({ ...plan, effort: 0 })).toThrow();
  });

  it("varsayilanlar dolar", () => {
    const p = Plan.parse(plan);
    expect(p.actions).toEqual([]);
    expect(p.goalNodeIds).toEqual([]);
  });
});

describe("cocuklariGetir", () => {
  it("duz agactan cocuklari cozer", () => {
    const agac = [
      GoalNode.parse({ id: "n1", parentId: null, statement: "kok", type: "goal", children: ["n2"] }),
      GoalNode.parse({ id: "n2", parentId: "n1", statement: "dal", type: "lever", children: [] }),
    ];
    expect(cocuklariGetir(agac, "n1").map((d) => d.id)).toEqual(["n2"]);
  });

  it("olmayan cocuk id'si sessizce atlanir", () => {
    const agac = [GoalNode.parse({ id: "n1", parentId: null, statement: "k", type: "goal", children: ["yok"] })];
    expect(cocuklariGetir(agac, "n1")).toEqual([]);
  });
});
