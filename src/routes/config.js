import pg from 'pg';
import { getSecret } from '../services/secrets.js';

let pool;

export const db = {
  async query(sql, params) {
    if (!pool) {
      const secret = await getSecret('field-quote/db');
      pool = new pg.Pool({
        host:     secret.host,
        port:     parseInt(secret.port),
        database: secret.database,
        user:     secret.user,
        password: secret.password,
        ssl:      { rejectUnauthorized: false },
        max: 1,   // Lambda: keep pool small
      });
    }
    return pool.query(sql, params);
  }
};
