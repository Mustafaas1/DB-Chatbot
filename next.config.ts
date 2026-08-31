import type { NextConfig } from "next";

const config: NextConfig = {
  // Ev dizininde baska bir package-lock.json var; Next onu gorup proje
  // kokunu C:\Users\Mustafa saniyor ve src/app'i hic bulmuyordu.
  turbopack: { root: import.meta.dirname },
};

export default config;
