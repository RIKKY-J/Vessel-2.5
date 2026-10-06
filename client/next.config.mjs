/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'dockerode', 'bcryptjs', 'aws-sdk'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        http2: false,
        dns: false,
        child_process: false,
      };
    }
    return config;
  },
  async rewrites() {
    const backendUrl = process.env.RENDER_BACKEND_URL;
    if (backendUrl) {
      return [
        {
          source: "/api/preview/:path*",
          destination: `${backendUrl}/api/preview/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
