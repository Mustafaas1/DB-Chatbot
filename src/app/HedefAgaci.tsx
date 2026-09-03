"use client";

import { useState } from "react";
import type { GoalNodeGenis } from "@/schemas/index";
import type { TreeResult } from "@/core/hedef/tipler";

/**
 * Dugum ve agac tipleri KANONIK semadan geliyor (spec bolum 5).
 *
 * Onceden burada kopyalari vardi ve sapmislardi: `measurementQuery`
 * burada "varsa string", semada "string | undefined" idi. Tip birlestirme
 * sirasinda ortaya cikti. Kopya sema, sessizce ayrisan semadir.
 */
export type Dugum = GoalNodeGenis;
export type DugumTuru = Dugum["type"];
export type Kanit = Dugum["evidence"][number];
export type AgacYaniti = TreeResult;

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

/** Agacta gosterilecek kadar plan bilgisi; Planlar tipine bagimli olmamak icin dar. */
export interface BagliPlan {
  id: string;
  title: string;
  skor: number;
  goalNodeIds: string[];
  ajanAd: string;
  renk: string;
}

function DugumKarti({
  dugum, agac, planlar,
}: { dugum: Dugum; agac: Map<string, Dugum>; planlar: BagliPlan[] }) {
  const [acik, setAcik] = useState(false);
  const cocuklar = dugum.children
    .map((id) => agac.get(id))
    .filter((d): d is Dugum => Boolean(d));

  const bagliPlanlar = planlar.filter((p) => p.goalNodeIds.includes(dugum.id));

  return (
    <li className={`agac-dugum tur-${dugum.type}`}>
      <div
        className={`dugum-kart tiklanabilir ${acik ? "acik" : ""}`}
        role="button"
        tabIndex={0}
        title="Kanıtı ve bağlı planları göster"
        onClick={() => setAcik((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAcik((o) => !o); } }}
      >
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

        {/* Tiklaninca: ham kanit ve bu dugumden dogan planlar. Ozet gorunumu
            kalabaliklastirmamak icin varsayilan kapali. */}
        {acik && (
          <div className="dugum-ayrinti">
            <div className="dugum-ayrinti-baslik">Kanıt</div>
            {dugum.evidence.length === 0 ? (
              <div className="dugum-ayrinti-bos">Bu düğüm için kanıt üretilmedi.</div>
            ) : dugum.evidence.map((k, i) => (
              <div key={i} className="dugum-kanit-satir">
                <span className={`kanit-kaynak k-${k.source}`}>{k.source}</span>
                <span className="kanit-deger">{JSON.stringify(k.value)}</span>
                <span className="kanit-guven">%{Math.round(k.confidence * 100)}</span>
                {k.query && <div className="kanit-sorgu">{k.query}</div>}
              </div>
            ))}

            <div className="dugum-ayrinti-baslik">Bu düğümden doğan planlar</div>
            {bagliPlanlar.length === 0 ? (
              <div className="dugum-ayrinti-bos">Henüz plan bağlanmadı.</div>
            ) : bagliPlanlar.map((p) => (
              <div key={p.id} className="dugum-plan">
                <i className="ajan-nokta" style={{ background: p.renk }} />
                {p.title}
                <span className="dugum-plan-skor">{p.skor.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {cocuklar.length > 0 && (
        <ul className="agac-dal">
          {cocuklar.map((c) => (
            <DugumKarti key={c.id} dugum={c} agac={agac} planlar={planlar} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function HedefAgaci({
  agac, planlar = [],
}: { agac: AgacYaniti; planlar?: BagliPlan[] }) {
  const { kullanim, notExpanded, dugumler } = agac;
  const harita = new Map(dugumler.map((d) => [d.id, d]));
  const kok = dugumler.find((d) => d.parentId === null);

  if (!kok) return null;

  return (
    <div className="kart">
      <div className="bolum-baslik">Hedef ağacı</div>
      <p className="agac-aciklama">
        Soru doğrudan cevaplanmaz; önce hedefe götüren kaldıraçlara, oradan
        veriyle ölçülebilir sorulara ayrılır. Bir düğüme tıklayınca ham kanıtı
        ve o düğümden doğan planlar görünür.
      </p>
      <ul className="agac-kok">
        <DugumKarti dugum={kok} agac={harita} planlar={planlar} />
      </ul>
      <div className="alt-bilgi">
        {kullanim.cagriSayisi} çağrı · {kullanim.girdiTokeni} + {kullanim.ciktiTokeni} token
        {" · "}{dugumler.length} düğüm
        {notExpanded > 0 && ` · ${notExpanded} dal bütçe nedeniyle açılmadı`}
      </div>
    </div>
  );
}
