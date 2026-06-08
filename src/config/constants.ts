import * as dotenv from 'dotenv';
dotenv.config({ override: true });

export const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || '1234567890@g.us';

export const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '')
  .split(',')
  .map(num => num.trim())
  .filter(Boolean);
