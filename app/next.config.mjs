/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK is used from source (../sdk/src); its NodeNext-style ".js" imports point at ".ts" files.
  // Turbopack (the Next 16 default) has no equivalent of webpack's extensionAlias, so this app builds with
  // webpack (`next build --webpack`, see package.json).
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;
