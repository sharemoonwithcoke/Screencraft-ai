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
    // Enable server actions
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
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
