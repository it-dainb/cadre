// Dev-only: lets plain node run the kit-style TS (extensionless imports, 'claude-code/testing'). Use: node --experimental-transform-types --import ./tests/dev/register.mjs <file>
import { register } from 'node:module'
register('./hooks.mjs', import.meta.url)
