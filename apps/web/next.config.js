/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/categories_new",
        destination: "/categories",
        permanent: true,
      },
      {
        source: "/categories_new/:slug*",
        destination: "/categories/:slug*",
        permanent: true,
      },
    ];
  },
  allowedDevOrigins: ["192.168.0.60"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      {
        protocol: "https",
        hostname: "media.licdn.com",
      },
      {
        protocol: "https",
        hostname: "*.gravatar.com",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"]
  }
};

module.exports = nextConfig;
