/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: '#135bec',
          hover: '#0e4bce',
          light: '#eef4ff'
        },
        dark: {
          bg: '#0f1115',
          surface: '#161b22',
          border: '#232d42'
        }
      }
    }
  },
  plugins: [],
}
