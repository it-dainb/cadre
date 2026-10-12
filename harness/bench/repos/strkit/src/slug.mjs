// slug('Hello, World!') -> 'hello-world'
export const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
