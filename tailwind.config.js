module.exports = {
  content: ['./index.html', './renderer.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Segoe UI', 'sans-serif'] },
      colors: {
        ink: { 950: '#050914', 900: '#080f1e', 850: '#0c1528', 800: '#111d34' },
        accent: { 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
      },
      boxShadow: { glow: '0 0 32px rgba(14, 165, 233, 0.14)' },
    },
  },
  plugins: [],
};
