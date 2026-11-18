/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK is used from source (../sdk/src); its NodeNext-style ".js" imports point at ".ts" files.
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;
