const isDev = process.env.NODE_ENV !== "production";

/**
 * Report-only policy: nothing is blocked, violations are POSTed to /api/csp-report. It records which
 * third-party origins the wallet SDKs (WalletConnect, Coinbase, MetaMask) really use, so the policy can be
 * tightened and enforced later without breaking wallet connections.
 */
const reportOnlyPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https: wss:${isDev ? " http://127.0.0.1:* http://localhost:* ws://localhost:*" : ""}`,
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.org https://keys.coinbase.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "report-uri /api/csp-report",
].join("; ");

/**
 * Enforced security headers. Script-src is enforced only in report-only mode above: wallet SDKs load remote
 * resources, so a strict script policy needs the report data first. These headers block clickjacking of the
 * organizer console, MIME sniffing and referrer leaks of check-in URLs (which carry the rotating QR signature).
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a verification build (`NEXT_DIST_DIR=.next-verify npm run build`) run next to `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Share images (lib/og.tsx) read the logo from disk; make sure serverless bundles include it.
  outputFileTracingIncludes: {
    "/**": ["./public/brand/oncv-mark.png"],
  },
  eslint: {
    dirs: ["app", "components", "config", "lib"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // `npm run dev` uses Turbopack: it compiles only what a page needs, so first page loads and code changes are
  // several times faster than webpack with the ~13k modules the wallet SDKs pull in. Same aliases as below.
  turbopack: {
    resolveAlias: {
      "pino-pretty": "./lib/empty-module.js",
      lokijs: "./lib/empty-module.js",
      encoding: "./lib/empty-module.js",
      "@react-native-async-storage/async-storage": "./lib/empty-module.js",
      // Unlike webpack aliases, Turbopack aliases do not cover subpaths, so the imported ones are listed.
      "@x402/core": "./lib/empty-module.js",
      "@x402/core/client": "./lib/empty-module.js",
      "@x402/evm": "./lib/empty-module.js",
      "@x402/evm/exact/client": "./lib/empty-module.js",
      "@x402/evm/upto/client": "./lib/empty-module.js",
      "@x402/svm": "./lib/empty-module.js",
      "@x402/svm/exact/client": "./lib/empty-module.js",
      "@x402/extensions": "./lib/empty-module.js",
    },
  },
  // Production builds (`npm run build`) and `npm run dev:webpack` use webpack.
  webpack: (config) => {
    // Optional peer deps pulled in by WalletConnect / MetaMask SDK that are never used in the browser.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    // Optional peer deps of @coinbase/cdp-sdk (reached via wagmi's Base Account connector). They are only
    // used by x402 payment helpers this app never calls, so resolve them to empty modules.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      "@x402/extensions": false,
    };
    // viem's bundled "tempo" chain definitions use a dynamic import webpack cannot analyse; harmless here.
    config.ignoreWarnings = [...(config.ignoreWarnings ?? []), { module: /node_modules[\\/]ox[\\/]_esm[\\/]tempo/ }];
    return config;
  },
};

export default nextConfig;
