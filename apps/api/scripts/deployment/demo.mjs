import { initialize } from './settings.mjs';
import { compose, verify } from './commands.mjs';
import { backup, restore } from './backups.mjs';

const [command, value, confirmation] = process.argv.slice(2);
try {
  switch (command) {
    case 'init':
      initialize(value);
      break;
    case 'config':
      compose(['config', '--quiet']);
      break;
    case 'build':
      compose(['build']);
      break;
    case 'up':
      compose(['build']);
      compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '600']);
      break;
    case 'verify':
      await verify();
      break;
    case 'status':
      compose(['ps']);
      break;
    case 'backup':
      backup();
      break;
    case 'restore':
      restore(value, confirmation);
      break;
    default:
      throw new Error(
        'Use init PUBLIC_IP | config | build | up | verify | status | backup | restore BACKUP_PATH TICKETCHAIN_DEMO',
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
