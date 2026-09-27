import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must load from node_modules rather than being bundled.
  serverExternalPackages: ["better-sqlite3", "@napi-rs/keyring"],
};

export default nextConfig;
