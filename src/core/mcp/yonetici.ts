import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import type { AracKaydi } from "../tools/kayit";
import type { AracTanimi } from "../tools/tipler";

/** mcp.json bicimi. */
export const McpAyarSemasi = z.object({
  sunucular: z.record(
    z.string(),
    z.object({
      komut: z.string().min(1),
      argumanlar: z.array(z.string()).default([]),
      ortam: z.record(z.string(), z.string()).optional(),
      /** Kapali sunucular baglanmaz; silmeden devre disi birakmak icin. */
      kapali: z.boolean().default(false),
    })
  ).default({}),
});
export type McpAyari = z.infer<typeof McpAyarSemasi>;

export interface BagliSunucu {
  ad: string;
  istemci: Client;
  aracSayisi: number;
}

/**
 * MCP sunucularini baglar ve araclarini kayda ekler.
 *
 * GUVENLIK VARSAYILANI: MCP araci yan etkisini bildirmek ZORUNDA degil.
 * Bildirmeyeni "yazma" sayiyoruz -- yani onay kapisina takilir. Tersi
 * (bilinmeyeni okuma saymak) disaridan gelen bir aracin sessizce
 * calismasina izin verirdi.
 */
export class McpYoneticisi {
  readonly #bagli: BagliSunucu[] = [];

  static async ayarOku(yol: string): Promise<McpAyari> {
    try {
      const ham = await readFile(yol, "utf8");
      return McpAyarSemasi.parse(JSON.parse(ham));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { sunucular: {} };
      throw new Error(`${yol} okunamadi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async bagla(ayar: McpAyari, kayit: AracKaydi): Promise<BagliSunucu[]> {
    for (const [ad, s] of Object.entries(ayar.sunucular)) {
      if (s.kapali) continue;

      const istemci = new Client({ name: "is-zekasi-ajan", version: "0.1.0" }, { capabilities: {} });
      await istemci.connect(
        new StdioClientTransport({
          command: s.komut,
          args: s.argumanlar,
          ...(s.ortam ? { env: s.ortam } : {}),
        })
      );

      const { tools } = await istemci.listTools();
      for (const t of tools) {
        // Ad cakismasini onlemek icin sunucu adiyla nitelendiriyoruz.
        const aracAdi = `${ad}__${t.name}`;
        const saltOkunur = t.annotations?.readOnlyHint === true;

        const arac: AracTanimi<Record<string, unknown>, unknown> = {
          ad: aracAdi,
          aciklama: t.description ?? `${ad} sunucusundan ${t.name}`,
          kaynak: "mcp",
          yanEtki: saltOkunur ? "okuma" : "yazma",
          // Disaridan gelen aracin riskini bilmiyoruz; salt okunur
          // degilse yuksek sayiyoruz. Bilinmeyeni dusuk saymak, tanimadigimiz
          // bir aracin sessizce calismasina izin verirdi.
          risk: saltOkunur ? "low" : "high",
          // MCP girdi semasi JSON Schema; sunucu kendi dogrulamasini yapar.
          // Burada yalnizca "nesne olmali" sarti konuyor.
          girdiSemasi: z.record(z.string(), z.unknown()),
          async calistir(girdi, baglam) {
            if (baglam.provaMi) return { prova: true, arac: aracAdi, girdi };
            return await istemci.callTool({ name: t.name, arguments: girdi });
          },
        };
        kayit.kaydet(arac);
      }

      this.#bagli.push({ ad, istemci, aracSayisi: tools.length });
    }
    return this.#bagli;
  }

  async kapat(): Promise<void> {
    for (const s of this.#bagli) {
      try { await s.istemci.close(); } catch { /* kapanis hatasi yutulur */ }
    }
    this.#bagli.length = 0;
  }
}
