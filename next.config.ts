import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-oxide", "pdfjs-dist"],
};

export default nextConfig;

