/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: '#7B2BF9',
          pink: '#E22B7E',
          red: '#F61B2E',
          dark: '#0A0A0A',
        },
        primary: {
          50: '#FDF2F3',
          100: '#FCE4E7',
          200: '#F9BFC5',
          300: '#F58F98',
          400: '#F05F6B',
          500: '#F61B2E', // Brand Red
          600: '#D11727',
          700: '#A91220',
          800: '#840E19',
          900: '#5E0A12',
        },
      },
      keyframes: {
        'buy-glow': {
          '0%, 100%': { boxShadow: '0 0 0 8px rgba(246,27,46,0.12)' },
          '50%': { boxShadow: '0 0 0 18px rgba(246,27,46,0.20)' },
        },
      },
      animation: {
        'buy-glow': 'buy-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
