import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/editor/export", destination: "/editor" }];
  },
};
export default nextConfig;
