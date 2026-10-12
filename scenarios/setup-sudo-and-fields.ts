import { bare, dec } from './base'
const OK = { key: 'a', label: 'Confirm', verb: 'approve', run: 'setup confirm' }
export default bare('no plan yet: the setup plan (a sudo line) first, then a decision with fields (git identity), asked one by one in the dialog', {
  decisions: [
    dec('init:90', 'init', 'setup plan ready · confirm it', ['  1. installing bd', '  2. enabling the sandbox', 'you run once:', '  ! sudo sh /tmp/cadre-setup.sh'], [OK, { key: 'x', label: 'Cancel', verb: 'reject', run: 'setup cancel' }]),
    dec('init:91', 'init', 'git needs an identity', ['git cannot commit without a name and email.', 'cadre never makes one up: type yours.'], [{ key: 'a', label: 'Save', verb: 'approve', run: 'init identity {fields}' }, { key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }],
      { fields: [{ key: 'name', label: 'name', value: 'Ada' }, { key: 'email', label: 'email' }], error: 'email is empty' }),
  ],
})
