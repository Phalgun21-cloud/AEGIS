import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Pages load their data in mount effects (fetch, then setState); that's intended here.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "next-env.d.ts"] },
];

export default config;
