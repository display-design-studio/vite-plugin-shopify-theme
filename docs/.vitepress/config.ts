import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Vite Shopify Theme',
  description: 'Explicit Vite entries for Shopify themes',
  base: '/vite-plugin-shopify-theme/',
  themeConfig: {
    search: { provider: 'local' },
    editLink: { pattern: 'https://github.com/display-design-studio/vite-plugin-shopify-theme/edit/main/docs/:path' },
    nav: [
      { text: 'Guide', link: '/why-this-plugin' },
      { text: 'Cookbook', link: '/cookbook/' },
      { text: 'API', link: '/public-api' },
    ],
    sidebar: [
      { text: 'Guide', items: [
        { text: 'Why this plugin?', link: '/why-this-plugin' },
        { text: '1. Getting Started', link: '/getting-started' }, { text: '2. CLI init', link: '/cli-init' },
        { text: '3. Development Modes', link: '/development-modes' }, { text: '4. Configuration', link: '/configuration' },
        { text: '5. Tailwind & Frameworks', link: '/tailwind-frameworks' }, { text: '6. Advanced Workflows', link: '/advanced-workflows' },
        { text: '7. Working with AI agents', link: '/agents' },
      ] },
      { text: 'Cookbook', collapsed: false, items: [
        { text: 'Overview', link: '/cookbook/' },
        { text: 'Setup checklist', link: '/cookbook/setup-checklist' },
        { text: 'Live Theme Editor with a tunnel', link: '/cookbook/theme-editor-and-tunnels' },
        { text: 'Fonts, images, and vendor code', link: '/cookbook/fonts-images-vendors' },
        { text: 'Page-specific entrypoints', link: '/cookbook/page-specific-entrypoints' },
        { text: 'Developer experience', link: '/cookbook/developer-experience' },
        { text: 'Quality tooling', link: '/cookbook/quality-tooling' },
        { text: 'Performance patterns', link: '/cookbook/performance-patterns' },
      ] },
      { text: 'Reference', items: [
        { text: 'Public API', link: '/public-api' }, { text: 'Troubleshooting', link: '/troubleshooting' },
        { text: 'Support & Compatibility', link: '/support-compatibility' },
      ] },
    ], socialLinks: [{ icon: 'github', link: 'https://github.com/display-design-studio/vite-plugin-shopify-theme' }],
  },
});
