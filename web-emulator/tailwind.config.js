/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}'
    ],
    theme: {
        extend: {
            colors: {
                epaperBg: '#f8f8f0',    // Slightly warmer off-white like e-paper
                epaperInk: '#1a1a1a'    // Darker black for better contrast
            },
            boxShadow: {
                insetThin: 'inset 0 0 0 1px #333, inset 2px 2px 4px rgba(0,0,0,0.1)'
            },
            fontFamily: {
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
            }
        }
    },
    plugins: []
};
