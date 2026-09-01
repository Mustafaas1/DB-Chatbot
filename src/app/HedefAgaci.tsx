"use client";

export type DugumTuru = "goal" | "lever" | "metric" | "resource" | "action";

export interface Kanit {
  source: "db" | "api" | "mcp" | "llm-inference";
  query?: string;
  value: unknown;
  confidence: number;
}

export interface Dugum {
  id: string;
  parentId: string | null;
  statement: string;
  type: DugumTuru;
  rationale: string;
  measurementQuery?: string;
  currentValue?: number | null;
  targetValue?: number | null;
  evidence: Kanit[];
  children: string[];
  status: "pending" | "measuring" | "measured" | "failed";
}

export interface AgacYaniti {
  dugumler: Dugum[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number; cagriSayisi: number };
  genisletilmeyen: number;
}

const TUR_ETIKET: Record<DugumTuru, string> = {
  goal: "Hedef",
  lever: "Kaldıraç",
  metric: "Ölçüm",
  resource: "Kaynak",
  action: "Aksiyon",
};

/** Kanıt yalnızca llm-inference ise değer doğrulanmamıştır. */
function dogrulanmisMi(d: Dugum): boolean {
  return d.evidence.some((e) => e.source !== "llm-inference");
}

function DugumKarti({ dugum, agac }: { dugum: Dugum; agac: Map<string, Dugum> }) {
  const cocuklar = dugum.children
    .map((id) => agac.get(id))
    .filter((d): d is Dugum => Boolean(d));

  return (
    <li className={`agac-dugum tur-${dugum.type}`}>
      <div className="dugum-kart">
        <span className="dugum-rozet">{TUR_ETIKET[dugum.type]}</span>
        <div className="dugum-baslik">{dugum.statement}</div>
        {dugum.rationale && <div className="dugum-gerekce">{dugum.rationale}</div>}

        {dugum.measurementQuery && (
          <div className="dugum-olcum">
            <span>veriye sorulacak:</span> {dugum.measurementQuery}
          </div>
        )}

        {dugum.currentValue != null && (
          <div className="dugum-deger">
            <span>ölçülen:</span> {dugum.currentValue.toLocaleString("tr-TR")}
            {dugum.targetValue != null && (
              <> · <span>hedef:</span> {dugum.targetValue.toLocaleString("tr-TR")}</>
            )}
          </div>
        )}

        {/* Kanit kaynagi: "veritabanindan okundu" ile "model tahmin etti"
            ayirt edilebilsin diye. */}
        {dugum.evidence.length > 0 && (
          <div className={`dugum-kanit ${dogrulanmisMi(dugum) ? "" : "tahmin"}`}>
            {dogrulanmisMi(dugum)
              ? `veriyle doğrulandı (${dugum.evidence.map((e) => e.source).join(", ")})`
              : "yalnızca model tahmini — veriyle doğrulanmadı"}
          </div>
        )}
      </div>

      {cocuklar.length > 0 && (
        <ul className="agac-dal">
          {cocuklar.map((c) => <DugumKarti key={c.id} dugum={c} agac={agac} />)}
        </ul>
      )}
    </li>
  );
}

export function HedefAgaci({ agac }: { agac: AgacYaniti }) {
  const { kullanim, genisletilmeyen, dugumler } = agac;
  const harita = new Map(dugumler.map((d) => [d.id, d]));
  const kok = dugumler.find((d) => d.parentId === null);

  if (!kok) return null;

  return (
    <div className="kart">
      <div className="bolum-baslik">Hedef ağacı</div>
      <p className="agac-aciklama">
        Soru doğrudan cevaplanmaz; önce hedefe götüren kaldıraçlara, oradan
        veriyle ölçülebilir sorulara ayrılır.
      </p>
      <ul className="agac-kok">
        <DugumKarti dugum={kok} agac={harita} />
      </ul>
      <div className="alt-bilgi">
        {kullanim.cagriSayisi} çağrı · {kullanim.girdiTokeni} + {kullanim.ciktiTokeni} token
        {" · "}{dugumler.length} düğüm
        {genisletilmeyen > 0 && ` · ${genisletilmeyen} dal bütçe nedeniyle açılmadı`}
      </div>
    </div>
  );
}
