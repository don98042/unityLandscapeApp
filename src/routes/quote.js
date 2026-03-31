import { json }         from '../handler.js';
import { analyzePhoto } from '../services/vision.js';
import { buildQuote }   from '../services/quoteEngine.js';
import { uploadPhoto }  from '../services/storage.js';
import { db }           from '../db/client.js';

export async function quoteRoute(event) {
  // Expect multipart/form-data — API Gateway base64-encodes binary
  const body     = Buffer.from(event.body, 'base64');
  const boundary = event.headers['content-type'].split('boundary=')[1];
  const photoBuffer = extractFilePart(body, boundary);

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
         (quote_id, service_code, description, qty, unit, tier,
          unit_price, total, confidence, ai_suggested)
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
  const partStart = parts[0] + sep.length + 2;
  const headerEnd = buffer.indexOf('\r\n\r\n', partStart);
  const partEnd   = parts[1] - 2;
  return buffer.slice(headerEnd + 4, partEnd);
}
