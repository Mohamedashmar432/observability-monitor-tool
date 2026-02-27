/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/popup/**/*.{tsx,ts,html}',
    './src/options/**/*.{tsx,ts,html}',
  ],
  theme: {
    extend: {
      colors: {
        synthmon: {
          navy: '#1a1a2e',
          purple: '#16213e',
          accent: '#0f3460',
          red: '#e94560',
        },
      },
    },
  },
  plugins: [],
};
