// Dev-only: lets plain node run the kit-style TS (extensionless imports, 'claude-code/testing'). Use: node --experimental-transform-types --import ./tests/dev/register.mjs <file>
import { register } from 'node:module'
register('./hooks.mjs', import.meta.url)
// the default profile as a session loads it (core/profile expands ${MODULES} to the plugin's modules folder): a world that closes a task runs its delivery hooks for real
const { setProfile } = await import('../../core/pipeline.ts'), { profile } = await import('../../profiles/default.ts')
export const sessionProfile = JSON.parse(JSON.stringify(profile).split('${MODULES}').join(new URL('../../modules', import.meta.url).pathname))
setProfile(sessionProfile)
