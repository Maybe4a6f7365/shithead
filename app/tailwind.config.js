// ============================================================================
// The utility-class names for the design tokens in src/styles/tokens.css.
// Colours, spacing, radii, z-index and the display font repeat those tokens
// value for value, and lastCallTheme.test.ts fails if the two drift apart.
// Font sizes and letter spacing are defined here only.
// ============================================================================
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: '#173d2f',
        'felt-deep': '#0c2b21',
        cream: '#f1e5c7',
        'cream-dim': 'rgba(241, 229, 199, 0.74)',
        ink: '#17241d',
        'ink-soft': '#566158',
        burgundy: '#b43c32',
        gold: '#d0a64d',
        'gold-bright': '#f1e5c7',
        'danger-bright': '#f08072',
        'muted-felt': '#b7aa8e',
        online: '#a7c8aa',
        hairline: 'rgba(241, 229, 199, 0.20)',
        scrim: 'rgba(6, 25, 18, 0.86)',
        'card-edge': 'rgba(23, 36, 29, 0.20)',
      },
      fontFamily: {
        display: ['Impact', 'Haettenschweiler', '"Arial Narrow Bold"', '"Arial Black"', 'sans-serif'],
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
        s5: '24px', s6: '32px', s7: '48px',
      },
      borderRadius: {
        button: '8px',
      },
      zIndex: {
        sheet: '60',
        scrim: '90',
        overlay: '100',
      },
    },
  },
  plugins: []
}
