import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        page: '#060609',
        card: '#0c0c12',
        elevated: '#12121c',
        border: {
          DEFAULT: '#18181e',
          strong: '#242432',
        },
        gold: {
          DEFAULT: '#c9a94e',
          bright: '#e8c76e',
          dim: '#614e24',
          faint: '#1a1408',
        },
        ink: {
          DEFAULT: '#ede8d8',
          muted: '#7a7870',
          faint: '#2c2c38',
        },
        teal: {
          DEFAULT: '#10b981',
          dim: '#0d4f38',
          faint: '#061a12',
        },
        crimson: {
          DEFAULT: '#f87171',
          dim: '#5c2020',
          faint: '#1a0808',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'monospace'],
        display: ['var(--font-display)', 'serif'],
      },
      animation: {
        blink: 'blink 1.1s step-end infinite',
        'fade-up': 'fadeUp 0.5s ease forwards',
        'fade-in': 'fadeIn 0.3s ease forwards',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
        scan: 'scan 12s linear infinite',
      },
      keyframes: {
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
      boxShadow: {
        gold: '0 0 24px rgba(201,169,78,0.12)',
        'gold-sm': '0 0 8px rgba(201,169,78,0.15)',
        teal: '0 0 24px rgba(16,185,129,0.12)',
      },
    },
  },
  plugins: [],
}

export default config
