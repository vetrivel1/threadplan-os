import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev indicator defaults to bottom-left, where it sits on top of the
  // sidebar's expand/collapse control and swallows its clicks.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
