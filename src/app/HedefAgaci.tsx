"use client";

export type DugumTuru = "hedef" | "surucu" | "olcum" | "aksiyon";

export interface Dugum {
  id: string;
  baslik: string;
  tur: DugumTuru;
  gerekce: string;
  seviye: number;
  cocuklar: Dugum[];
  olcumSorusu?: string;
}

export interface AgacYaniti {
  kok: Dugum;
  kullanim: { girdiTokeni: number; ciktiTokeni: number; cagriSayisi: number };
  genisletilmeyen: number;
}

const TUR_ETIKET: Record<DugumTuru, string> = {
  hedef: "Hedef",
  surucu: "Sürücü",
  olcum: "Ölçüm",
  aksiyon: "Aksiyon",
};

function DugumKarti({ dugum }: { dugum: Dugum }) {
  return (
    <li className={`agac-dugum tur-${dugum.tur}`}>
      <div className="dugum-kart">
        <span className="dugum-rozet">{TUR_ETIKET[dugum.tur]}</span>
        <div className="dugum-baslik">{dugum.baslik}</div>
        {dugum.gerekce && <div className="dugum-gerekce">{dugum.gerekce}</div>}
        {dugum.olcumSorusu && (
          <div className="dugum-olcum">
            <span>veriye sorulacak:</span> {dugum.olcumSorusu}
          </div>
        )}
      </div>
      {dugum.cocuklar.length > 0 && (
        <ul className="agac-dal">
          {dugum.cocuklar.map((c) => <DugumKarti key={c.id} dugum={c} />)}
        </ul>
      )}
    </li>
  );
}

export function HedefAgaci({ agac }: { agac: AgacYaniti }) {
  const { kullanim, genisletilmeyen } = agac;
  return (
    <div className="kart">
      <div className="bolum-baslik">Hedef ağacı</div>
      <p className="agac-aciklama">
        Soru doğrudan cevaplanmaz; önce hedefe götüren sürücülere, oradan
        veriyle ölçülebilir sorulara ayrılır.
      </p>
      <ul className="agac-kok">
        <DugumKarti dugum={agac.kok} />
      </ul>
      <div className="alt-bilgi">
        {kullanim.cagriSayisi} çağrı · {kullanim.girdiTokeni} + {kullanim.ciktiTokeni} token
        {genisletilmeyen > 0 && ` · ${genisletilmeyen} dal bütçe nedeniyle açılmadı`}
      </div>
    </div>
  );
}
