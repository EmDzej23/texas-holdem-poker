import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'deal-card': {
          '0%':   { opacity: '0', transform: 'translateY(-24px) scale(0.75) rotateY(90deg)' },
          '60%':  { opacity: '1', transform: 'translateY(4px) scale(1.04) rotateY(0deg)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1) rotateY(0deg)' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(32px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'chip-appear': {
          '0%':   { opacity: '0', transform: 'scale(0.4) translateY(-6px)' },
          '70%':  { opacity: '1', transform: 'scale(1.15) translateY(0)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'pot-grow': {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)' },
        },
        'stack-flash': {
          '0%, 100%': { color: 'inherit' },
          '40%':      { color: '#fbbf24' },
        },
        'shrink': {
          'from': { width: '100%' },
          'to':   { width: '0%' },
        },
      },
      animation: {
        'deal':        'deal-card 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) both',
        'slide-up':    'slide-up 0.25s ease-out both',
        'chip':        'chip-appear 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) both',
        'pot-grow':    'pot-grow 0.4s ease-out both',
        'stack-flash': 'stack-flash 0.5s ease-out both',
        'shrink':      'shrink 30s linear forwards',
      },
    },
  },
  plugins: [],
};

export default config;
