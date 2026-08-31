import { randomUUID } from "node:crypto";
import { AracKaydi } from "./tools/kayit.js";
import type { Baglam } from "./tools/tipler.js";
import { veriSorgulaAraci } from "./db/aracSorgu.js";
import { McpYoneticisi } from "./mcp/yonetici.js";

export interface Sistem {
  kayit: AracKaydi;
  mcp: McpYoneticisi;
  kapat(): Promise<void>;
}

/** Yerel araclari kaydeder, MCP sunucularini baglar. */
export async function sistemKur(mcpAyarYolu = "mcp.json"): Promise<Sistem> {
  const kayit = new AracKaydi();
  kayit.kaydet(veriSorgulaAraci);

  const mcp = new McpYoneticisi();
  const ayar = await McpYoneticisi.ayarOku(mcpAyarYolu);
  await mcp.bagla(ayar, kayit);

  return {
    kayit,
    mcp,
    async kapat() {
      await mcp.kapat();
      const { havuzKapat } = await import("./db/havuz.js");
      await havuzKapat();
    },
  };
}

export function baglamOlustur(provaMi: boolean): Baglam {
  return { izId: randomUUID(), provaMi };
}
