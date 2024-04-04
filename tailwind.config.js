// tailwind.config.js
module.exports = {
  content: [
    
    "about.html",
    "classpage.html",
    "index.html",
    "kontak.html",
    "programpage.html",
    "trialpage.html"
  ],
    theme: {
      extend: {
        colors: {
          'custom-gray': '#333333',
          'custom-orange': '#FFA500',
          'custom-light-gray': '#F7F7F7',
          'custom-blue': '#0044CC',
          'custom-teal': '#00CCCC',
        },
        maxWidth: {
          prose: '65ch',
        },
        boxShadow: {
          'xl': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
          '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          
        }
      }
    }
  }
  