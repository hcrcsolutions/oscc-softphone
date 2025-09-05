import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    domains: ['img.daisyui.com'],
  },
};

export default nextConfig;
