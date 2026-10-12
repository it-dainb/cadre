import { slugOptions } from './options.mjs'
// slug('Hello, World!') -> 'hello-world'
export const slug = (s, opts) => { const { separator } = slugOptions(opts); return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, separator).split(separator).filter(Boolean).join(separator) }
