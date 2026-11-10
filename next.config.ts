import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/sync",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${process.env.NODE_ENV === "development" ? " ws://127.0.0.1:*" : ""}; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`,
          },
        ],
      },
    ];
  },
};
export default nextConfig;
