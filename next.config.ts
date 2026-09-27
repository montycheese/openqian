import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must load from node_modules rather than being bundled.
  serverExternalPackages: ["better-sqlite3", "@napi-rs/keyring", "ccxt"],
  experimental: {
    // Room for positions exports uploaded through the Import page.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
