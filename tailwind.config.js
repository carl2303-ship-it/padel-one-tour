/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '480px',
      },
      colors: {
        blue: {
          50: 'var(--brand-tint-50, #e6f2ff)',
          100: 'var(--brand-tint-100, #cce5ff)',
          200: 'var(--brand-tint-200, #99cbff)',
          300: 'var(--brand-tint-300, #66b0ff)',
          400: 'var(--brand-tint-400, #3395ff)',
          500: 'var(--brand-primary, #007BFF)',
          600: 'var(--brand-primary, #007BFF)',
          700: 'var(--brand-primary-hover, #0069d9)',
          800: 'var(--brand-tint-800, #0056b3)',
          900: 'var(--brand-tint-900, #004494)',
        },
      },
    },
  },
  plugins: [],
};
