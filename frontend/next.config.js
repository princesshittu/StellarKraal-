/** @type {import('next').NextConfig} */

// Bundle analyzer — run with ANALYZE=true npm run build to generate bundle reports.
// Closes #1070: bundle code splitting audit.
let withBundleAnalyzer = (config) => config;
try {
  withBundleAnalyzer = require("@next/bundle-analyzer")({
    enabled: process.env.ANALYZE === "true",
  });
} catch {
  // @next/bundle-analyzer is an optional dev dependency
}

const nextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // Allow collateral photo URLs from any HTTPS source.
    // Add specific domains here to tighten the allow-list in production.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
};

module.exports = withBundleAnalyzer(nextConfig);
