/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Handle wallet adapter packages
    if (!isServer) {
      config.externals.push('pino-pretty', 'lokijs', 'encoding');
    }
    
    // Ensure proper resolution for wallet adapters
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    
    return config;
  },
  // Suppress hydration warnings from wallet adapters
  typescript: {
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig
