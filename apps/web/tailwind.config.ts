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
        'winner-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.7) translateY(24px)' },
          '65%':  { opacity: '1', transform: 'scale(1.04) translateY(-4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'new-hand': {
          '0%':   { opacity: '0', transform: 'translateY(-28px) scale(0.85)' },
          '18%':  { opacity: '1', transform: 'translateY(0) scale(1.05)' },
          '30%':  { opacity: '1', transform: 'translateY(0) scale(1)' },
          '75%':  { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-16px) scale(0.9)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(250,204,21,0.4), 0 0 60px rgba(250,204,21,0.1)' },
          '50%':      { boxShadow: '0 0 35px rgba(250,204,21,0.7), 0 0 80px rgba(250,204,21,0.25)' },
        },
      },
      animation: {
        'deal':        'deal-card 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) both',
        'slide-up':    'slide-up 0.25s ease-out both',
        'chip':        'chip-appear 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) both',
        'pot-grow':    'pot-grow 0.4s ease-out both',
        'stack-flash': 'stack-flash 0.5s ease-out both',
        'shrink':      'shrink 30s linear forwards',
        'winner-pop':  'winner-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'new-hand':    'new-hand 2.6s ease-in-out both',
        'glow-pulse':  'glow-pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
