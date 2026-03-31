// ── src/handler.js ────────────────────────────────────────────────────
import { quoteRoute }  from './routes/quote.js';
import { configRoute } from './routes/config.js';

export const handler = async (event) => {
  const method = event.requestContext.http.method;
  const path   = event.requestContext.http.path;

  try {
    if (method === 'POST' && path === '/quote')           return await quoteRoute(event);
    if (method === 'GET'  && path === '/pricing-config')  return await configRoute.get(event);
    if (method === 'PUT'  && path === '/pricing-config')  return await configRoute.put(event);
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};

export function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}


// ── src/routes/quote.js ───────────────────────────────────────────────
import { json }        from '../handler.js';
import { analyzePhoto } from '../services/vision.js';
import { buildQuote }  from '../services/quoteEngine.js';
import { uploadPhoto } from '../services/storage.js';
import { db }          from '../db/client.js';

export async function quoteRoute(event) {
  // Expect multipart/form-data — API Gateway base64-encodes binary
  const body     = Buffer.from(event.body, 'base64');
  const boundary = event.headers['content-type'].split('boundary=')[1];
  const photoBuffer = extractFilePart(body, boundary);   // see helper below

  // 1. Upload annotated photo to S3
  const s3Key = await uploadPhoto(photoBuffer);

  // 2. Get current pricing config from DB
  const { rows: config } = await db.query(
    'SELECT * FROM pricing_config WHERE active = true'
  );

  // 3. Ask AI to analyze the photo
  const aiItems = await analyzePhoto(photoBuffer, config);

  // 4. Apply pricing to AI line items
  const { lineItems, subtotal } = buildQuote(aiItems, config);

  // 5. Persist quote as draft
  const { rows: [quote] } = await db.query(
    `INSERT INTO quotes (photo_s3_key, status, subtotal, total)
     VALUES ($1, 'draft', $2, $2) RETURNING id`,
    [s3Key, subtotal]
  );

  for (const item of lineItems) {
    await db.query(
      `INSERT INTO quote_line_items
         (quote_id, service_code, description, qty, unit, tier, unit_price, total, confidence, ai_suggested)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [quote.id, item.service_code, item.description, item.qty,
       item.unit, item.tier ?? null, item.unit_price, item.total, item.confidence]
    );
  }

  return json(200, { quote_id: quote.id, line_items: lineItems });
}

// Minimal multipart parser — pulls out the first file part
function extractFilePart(buffer, boundary) {
  const sep   = Buffer.from('--' + boundary);
  const parts = [];
  let   start = 0;
  while (true) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    parts.push(idx);
    start = idx + sep.length;
  }
  // Body of first file part starts after the double CRLF header block
  const partStart = parts[0] + sep.length + 2;        // skip \r\n after boundary
  const headerEnd = buffer.indexOf('\r\n\r\n', partStart);
  const partEnd   = parts[1] - 2;                     // strip trailing \r\n
  return buffer.slice(headerEnd + 4, partEnd);
}


// ── src/routes/config.js ──────────────────────────────────────────────
import { json } from '../handler.js';
import { db }   from '../db/client.js';

export const configRoute = {
  async get() {
    const { rows } = await db.query(
      'SELECT * FROM pricing_config WHERE active = true ORDER BY service_code'
    );
    return json(200, rows);
  },

  async put(event) {
    const items = JSON.parse(event.body);   // array of pricing records
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
    return json(200, { updated: items.length });
  }
};


// ── src/services/vision.js ────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from './secrets.js';

export async function analyzePhoto(photoBuffer, pricingConfig) {
  const { anthropic_api_key } = await getSecret('field-quote/ai');
  const client = new Anthropic({ apiKey: anthropic_api_key });

  const serviceList = pricingConfig.map(s =>
    `- ${s.service_code}: ${s.label} (${s.type})`
  ).join('\n');

  const prompt = `You are a landscaping estimator. Analyze this site photo and identify all work needed.

Available services:
${serviceList}

Size rules:
- Trees: estimate height in 5-ft increments (10, 15, 20, 25, 30+)
- Shrubs: small (<3ft), medium (3-5ft), large (>5ft)
- Hedges: estimate linear feet
- Turf/lawn: estimate square feet
- Unknown work: use service_code "general_labor", set confidence below 0.6

Return ONLY valid JSON — no prose, no markdown fences:
{
  "line_items": [
    {
      "service_code": "tree_removal",
      "description": "Oak tree removal",
      "qty": 20,
      "unit": "ft",
      "tier": null,
      "confidence": 0.85,
      "clarifying_question": null
    }
  ]
}

If size is ambiguous, set confidence < 0.6 and populate clarifying_question with a short question for the field user.`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg',
            data: photoBuffer.toString('base64') } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const raw = response.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw).line_items;
}


// ── src/services/quoteEngine.js ───────────────────────────────────────
export function buildQuote(aiItems, pricingConfig) {
  const configMap = Object.fromEntries(
    pricingConfig.map(c => [c.service_code, c])
  );

  const lineItems = aiItems.map(item => {
    const cfg = configMap[item.service_code] ?? configMap['general_labor'];
    let unit_price = 0;
    let total      = 0;

    if (cfg.type === 'per_unit' || cfg.type === 'time_based') {
      unit_price = parseFloat(cfg.unit_rate);
      total      = unit_price * (item.qty ?? 1);
    } else if (cfg.type === 'per_tier' && item.tier) {
      unit_price = parseFloat(cfg[`tier_${item.tier}`] ?? cfg.tier_md);
      total      = unit_price * (item.qty ?? 1);
    }

    // Apply minimum charge if set
    if (cfg.min_charge && total < parseFloat(cfg.min_charge)) {
      total = parseFloat(cfg.min_charge);
    }

    return { ...item, unit_price, total,
             label: cfg.label, unit: item.unit ?? cfg.unit_label };
  });

  const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0);
  return { lineItems, subtotal };
}


// ── src/services/storage.js ───────────────────────────────────────────
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function uploadPhoto(buffer) {
  const key = `photos/${new Date().toISOString().slice(0,10)}/${randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({
    Bucket: 'field-quote-photos',
    Key:    key,
    Body:   buffer,
    ContentType: 'image/jpeg',
  }));
  return key;
}


// ── src/services/secrets.js ───────────────────────────────────────────
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const cache  = {};   // cache secrets for the lifetime of the Lambda container

export async function getSecret(name) {
  if (cache[name]) return cache[name];
  const res = await client.send(new GetSecretValueCommand({ SecretId: name }));
  cache[name] = JSON.parse(res.SecretString);
  return cache[name];
}


// ── src/db/client.js ──────────────────────────────────────────────────
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
