/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          primary: '#05080f',
          card: '#0b1120',
          input: '#111a2e',
        },
        accent: {
          blue: '#3b9eff',
          cyan: '#22d3ee',
          green: '#10b981',
          amber: '#f59e0b',
          red: '#ef4444',
          purple: '#a78bfa',
        },
      },
      fontFamily: {
        display: ['DM Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
