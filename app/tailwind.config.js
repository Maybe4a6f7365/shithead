// ============================================================================
// Tailwind theme — 1:1 mirror of TOKENS.css (DESIGN.md §10).
// Hardcoded hex values are banned in components after this migration;
// they live ONLY here and in src/styles/index.css custom properties.
// ============================================================================
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: '#2d4a2b',
        'felt-raised': '#345631',
        'felt-deep': '#1f3a1e',
        cream: '#faf8f3',
        'cream-dim': 'rgba(250, 248, 243, 0.62)',
        ink: '#221c15',
        'ink-soft': '#5a5348',
        burgundy: '#a23a1e',
        gold: '#c8a35a',
        'gold-bright': '#dcb878',
        success: '#3e6b38',
        danger: '#b3371f',
        'danger-bright': '#f0a08e',
        'muted-felt': '#b8cbb2',
        online: '#8fae7f',
        hairline: 'rgba(250, 248, 243, 0.14)',
        scrim: 'rgba(31, 58, 30, 0.78)',
        'card-edge': 'rgba(34, 28, 21, 0.14)',
        'slot-dash': 'rgba(250, 248, 243, 0.35)',
        joinable: 'rgba(220, 184, 120, 0.55)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        ui: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      fontSize: {
        display: ['34px', '40px'],
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
