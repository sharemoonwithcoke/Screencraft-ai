/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Dockerfile.web standalone output
  output: "standalone",
  transpilePackages: ["@screencraft/shared"],
  images: {
    remotePatterns: [
      {
        // GCS signed URLs
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      {
        // fake-gcs-server (local dev)
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
    // Keep @google/generative-ai as a Node.js external so webpack never
    // tries to bundle it — it uses Node built-ins that break the client bundle.
    serverComponentsExternalPackages: ["@google/generative-ai"],
  },
  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
