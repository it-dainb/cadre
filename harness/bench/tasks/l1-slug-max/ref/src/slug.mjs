// slug('Hello, World!') -> 'hello-world'
export const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const slugMax = (s, max) => slug(s).slice(0, max).replace(/-+$/, '')
