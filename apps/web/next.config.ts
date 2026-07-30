import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Azure Static Web Apps (Free-Tier) serviert nur statische Dateien - kein Node-Server
  // für SSR. Der Build erzeugt deshalb reines HTML/JS/CSS in out/.
  output: "export",
};

export default nextConfig;
