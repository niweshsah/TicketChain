// Remove stale JavaScript after modules move or are deleted.
import { rmSync } from 'node:fs';
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
