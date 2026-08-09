// ============================================================================
// Tailwind mirror of the “Last Call” card-table palette in styles/index.css.
// ============================================================================
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: '#173d2f',
        'felt-raised': '#234b3a',
        'felt-deep': '#0c2b21',
        cream: '#f1e5c7',
        'cream-dim': 'rgba(241, 229, 199, 0.74)',
        ink: '#17241d',
        'ink-soft': '#566158',
        burgundy: '#b43c32',
        gold: '#d0a64d',
        'gold-bright': '#f1e5c7',
        success: '#92b89a',
        danger: '#b43c32',
        'danger-bright': '#f08072',
        'muted-felt': '#b7aa8e',
        online: '#a7c8aa',
        hairline: 'rgba(241, 229, 199, 0.20)',
        scrim: 'rgba(6, 25, 18, 0.86)',
        'card-edge': 'rgba(23, 36, 29, 0.20)',
        'slot-dash': 'rgba(241, 229, 199, 0.36)',
        joinable: 'rgba(208, 166, 77, 0.78)',
      },
      fontFamily: {
        display: ['Impact', 'Haettenschweiler', '"Arial Narrow Bold"', '"Arial Black"', 'sans-serif'],
        ui: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      fontSize: {
        display: ['34px', '38px'],
        code: ['30px', '36px'],
        title: ['20px', '26px'],
        body: ['15px', '22px'],
        label: ['11px', '16px'],
        feed: ['13px', '18px'],
        small: ['12px', '16px'],
        micro: ['11px', '16px'],
        button: ['15px', '20px'],
      },
      letterSpacing: {
        label: '0.09em',
        button: '0.06em',
        code: '0.22em',
        micro: '0.04em',
      },
      spacing: {
        s1: '4px', s2: '8px', s3: '12px', s4: '16px',
        s5: '24px', s6: '32px', s7: '48px', s8: '64px',
      },
      borderRadius: {
        well: '10px',
        button: '8px',
      },
      transitionDuration: {
        'dur-1': '120ms',
        'dur-2': '180ms',
        'dur-3': '260ms',
        'dur-4': '400ms',
      },
      transitionTimingFunction: {
        'ease-standard': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        'ease-settle': 'cubic-bezier(0.34, 1.3, 0.4, 1)',
      },
      zIndex: {
        table: '0',
        pile: '10',
        hand: '20',
        selected: '30',
        sheet: '60',
        scrim: '90',
        overlay: '100',
      },
    },
  },
  plugins: []
}
