import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/server/db/client';

await migrate(getDb(), { migrationsFolder: 'drizzle' });
console.log('Migrations applied');
await closeDb();
