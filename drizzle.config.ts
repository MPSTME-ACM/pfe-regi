import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql', // 'mysql' | 'sqlite'
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});