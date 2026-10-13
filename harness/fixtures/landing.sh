# overlay: a small landing page with three section components, for goals that name "a section" without saying which (the clarify cells)
. "$(dirname "$0")/_base.sh"
mkdir -p components
for c in Hero Navbar Timeline; do printf 'export function %s() {\n  return `<section class="%s"></section>`\n}\n' "$c" "${c,,}" >"components/$c.mjs"; done
cat >src/landing.mjs <<'JS'
import { Hero } from '../components/Hero.mjs'
import { Navbar } from '../components/Navbar.mjs'

export const landing = () => [Navbar(), Hero()].join('\n')
JS
commit 'feat: landing page'
