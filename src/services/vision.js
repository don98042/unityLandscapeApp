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

If size is ambiguous, set confidence < 0.6 and populate clarifying_question
with a short question for the field user.`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: photoBuffer.toString('base64')
          }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const raw = response.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw).line_items;
}
