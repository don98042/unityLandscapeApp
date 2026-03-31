import { respond } from '../handler.js';
import { db }      from '../db/client.js';

export const configRoute = {
  async get() {
    const { rows } = await db.query(
      'SELECT * FROM pricing_config WHERE active = true ORDER BY service_code'
    );
    return respond(200, rows);
  },

  async put(event) {
    const items = JSON.parse(event.body);
    for (const item of items) {
      await db.query(
        `INSERT INTO pricing_config
           (service_code, label, type, unit_rate, unit_label,
            tier_sm, tier_md, tier_lg, min_charge, active, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
         ON CONFLICT (service_code) DO UPDATE SET
           label=EXCLUDED.label, type=EXCLUDED.type,
           unit_rate=EXCLUDED.unit_rate, unit_label=EXCLUDED.unit_label,
           tier_sm=EXCLUDED.tier_sm, tier_md=EXCLUDED.tier_md, tier_lg=EXCLUDED.tier_lg,
           min_charge=EXCLUDED.min_charge, active=EXCLUDED.active,
           updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [item.service_code, item.label, item.type, item.unit_rate, item.unit_label,
         item.tier_sm, item.tier_md, item.tier_lg, item.min_charge,
         item.active ?? true, item.updated_by ?? 'admin']
      );
    }
    return respond(200, { updated: items.length });
  }
};
