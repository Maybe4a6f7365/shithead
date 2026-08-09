// ============================================================================
// Tailwind mirror of the midnight game palette in styles/index.css.
// ============================================================================
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: '#0b1120',
        'felt-raised': '#17233a',
        'felt-deep': '#070c17',
        cream: '#f8fafc',
        'cream-dim': 'rgba(226, 232, 240, 0.70)',
        ink: '#0b1020',
        'ink-soft': '#526075',
        burgundy: '#d33656',
        gold: '#f6b94b',
        'gold-bright': '#4de0c4',
        success: '#24c9ad',
        danger: '#d33656',
        'danger-bright': '#ff7b91',
        'muted-felt': '#93a4ba',
        online: '#43dfb9',
        hairline: 'rgba(148, 163, 184, 0.18)',
        scrim: 'rgba(3, 7, 18, 0.82)',
        'card-edge': 'rgba(15, 23, 42, 0.13)',
        'slot-dash': 'rgba(148, 163, 184, 0.42)',
        joinable: 'rgba(77, 224, 196, 0.68)',
      },
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
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
        well: '12px',
        button: '14px',
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
