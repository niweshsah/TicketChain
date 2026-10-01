import { rebuildSearch } from '../src/services/catalog/rebuild';
import { db } from '../src/shared/db';
import { closeRedis } from '../src/shared/infrastructure/redis';
void rebuildSearch()
  .then(() => console.log('Search index rebuilt.'))
  .finally(async () => {
    await closeRedis();
    await db.$disconnect();
  });
