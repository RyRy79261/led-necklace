import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        stage: {
          bg: '#08080b',
          panel: '#121218',
          border: '#26262f',
          accent: '#7c5cff',
        },
      },
    },
  },
  plugins: [],
};

export default config;
