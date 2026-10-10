import { MemoryStore } from '../task-management/adapters/memory/store'
import { contract } from './store-contract'

contract('memory', () => new MemoryStore(() => 1_700_000_000_000))
