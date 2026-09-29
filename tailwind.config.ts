import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

/**
 * onCV design tokens: monochrome zinc surfaces (Linear / Vercel style) with a single accent family taken
 * from the red panda logo (public/brand/oncv-mark.png). Verification uses the conventional blue tick color.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#09090B",
        brand: {
          DEFAULT: "#DD3136",
          50: "#FFF1EC",
          100: "#FED4C4",
          200: "#FD9D7C", // peach (ears, tail rings)
          300: "#F56B54", // coral
          400: "#EE5448", // red for text on the dark background (5.7:1)
          500: "#DD3136", // primary red
          600: "#B31133", // crimson
          700: "#860423", // deep crimson
          800: "#5C0318",
          900: "#3A020F",
        },
        verified: "#1D9BF0",
      },
      fontFamily: {
        // Geist is bundled locally (geist package), so builds never depend on fonts.googleapis.com.
        sans: ["var(--font-geist-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(255,255,255,0.03)",
        pop: "0 0 0 1px rgba(255,255,255,0.06), 0 24px 60px -24px rgba(0,0,0,0.9)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
