import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /bottlenecks and /workload were folded into the command view and the
  // department and person records; keep old links working.
  async redirects() {
    return [
      { source: "/bottlenecks", destination: "/", permanent: false },
      { source: "/workload", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
