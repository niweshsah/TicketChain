import 'dotenv/config';
import { clearAll, previewAll, validateExternalServices } from './cleanup/all';
import { sourceConnectionString } from './cleanup/database';
import {
  assertEventRemovable,
  deleteEvent,
  previewEvent,
} from './cleanup/event';
import { parseOptions, usage } from './cleanup/parse';
import { anonymizeUser, previewUser } from './cleanup/user';

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const { database } = sourceConnectionString();

  if (options.all) {
    console.log(
      JSON.stringify({ target: database, rows: await previewAll() }, null, 2),
    );
    if (!options.apply) {
      console.log(
        'Dry run only. Add --apply and --confirm-all to clear this database set.',
      );
      return;
    }
    if (!options.writersStopped)
      throw new Error(
        'Stop all web APIs and workers, then pass --writers-stopped',
      );
    if (options.confirmAll !== database.toUpperCase())
      throw new Error(
        `Type --confirm-all ${database.toUpperCase()} to continue`,
      );
    await validateExternalServices();
    await clearAll();
    console.log(
      'Application data, avatar objects, search index, cache and message queues cleared.',
    );
    return;
  }

  const user = options.user ? await previewUser(options.user) : undefined;
  if (user && options.event) {
    const event = await previewEvent(options.event, user.id);
    console.log(JSON.stringify({ database, user, event }, null, 2));
  } else if (user) {
    console.log(JSON.stringify({ database, user }, null, 2));
  } else if (options.event) {
    console.log(
      JSON.stringify(
        { database, event: await previewEvent(options.event) },
        null,
        2,
      ),
    );
  }

  if (options.event) await assertEventRemovable(options.event, user?.id);

  if (!options.apply) {
    console.log(
      'Dry run only. Add --apply and matching confirmation flags to continue.',
    );
    return;
  }
  if (!options.writersStopped)
    throw new Error(
      'Stop all web APIs and workers, then pass --writers-stopped',
    );
  if (user && options.confirmUser !== user.id)
    throw new Error(`Type --confirm-user ${user.id} to continue`);
  if (options.event && options.confirmEvent !== options.event)
    throw new Error(`Type --confirm-event ${options.event} to continue`);

  if (user) await anonymizeUser(user.id);
  if (options.event) await deleteEvent(options.event, user?.id);
  console.log(
    'Requested cleanup completed. Run the same command without --apply to verify.',
  );
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'help') {
    console.log(usage());
    process.exitCode = 0;
  } else {
    console.error(error instanceof Error ? error.message : 'Cleanup failed');
    process.exitCode = 1;
  }
});
