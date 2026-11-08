export const pageHead = (title: string, description: string) => () => ({
  meta: [
    { title: `${title} · Cascade` },
    { name: 'description', content: description },
    { property: 'og:title', content: `${title} · Cascade` },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ],
});
