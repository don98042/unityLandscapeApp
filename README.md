# Unity Landscape App

A mobile-first field quoting application for landscaping and tree service crews. Field workers capture a site photo, annotate it on-site, and receive an AI-generated quote in seconds — all from a mobile browser with no app installation required.

---

## How it works

1. **Capture** — The field worker opens the app on their iPhone and uses the live rear camera viewfinder to photograph the job site
2. **Annotate** — Drawing tools let the worker mark up the photo directly: circle areas, draw arrows, and add text labels (e.g. "Remove this tree", "Trim hedge")
3. **Analyze** — The annotated photo is uploaded to the backend where a vision AI model identifies plants, estimates sizes, and determines what work is needed
4. **Quote** — The AI returns structured line items which are priced against a centralized config. Low-confidence items are flagged for the worker to confirm
5. **Review & submit** — The worker adjusts quantities, resolves flagged items, optionally applies a discount, and submits the quote

---

## Architecture

```
iPhone (Safari PWA)
    │
    ├── Camera screen (index.html) — live viewfinder, annotation tools
    └── Quote review screen (React) — line items, pricing, discount, before/after photo
         │
         ▼
    AWS API Gateway (HTTPS)
         │
         ▼
    AWS Lambda (Node.js 20)
         ├── vision.js      — sends photo to Claude AI for analysis
         ├── quoteEngine.js — applies pricing config to AI line items
         └── storage.js     — saves annotated photo to S3
         │
         ├── RDS Postgres (t3.micro)
         │     ├── quotes             — quote records and status
         │     ├── quote_line_items   — individual line items per quote
         │     └── pricing_config     — centralized, admin-editable pricing rules
         │
         └── S3
               ├── unity-landscape-frontend  — built React app + index.html
               └── unity-landscape-photos    — annotated job site photos
```

---

## Pricing model

Three service types are supported, all configurable via the admin panel without code changes:

| Type | How it prices | Examples |
|---|---|---|
| `per_unit` | rate × quantity | Tree removal $85/ft, lawn mowing $0.04/sqft |
| `per_tier` | flat rate by size (small / medium / large) | Shrub trimming $25 / $45 / $70 |
| `time_based` | hourly rate × estimated hours | General labor $65/hr, 2-man crew $110/hr |

If the AI cannot identify the service type, it falls back to `time_based` and prompts the field worker to estimate hours.

---

## AI extraction rules

The vision model (Claude) is instructed to return structured JSON only — no prose. Size estimation rules:

- **Trees**: height in 5-ft increments (10, 15, 20, 25, 30+)
- **Shrubs**: small (<3ft), medium (3–5ft), large (>5ft)
- **Hedges**: linear feet
- **Lawn/turf**: square feet
- **Unknown work**: flagged as `general_labor` with `confidence < 0.6` and a `clarifying_question` shown to the field worker

---

## Project structure

```
unityLandscapeApp/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD — auto-deploys Lambda on push to main
├── infra/
│   └── setup.sh                # One-time AWS resource provisioning script
├── src/
│   ├── handler.js              # Lambda entry point — routes requests
│   ├── routes/
│   │   ├── quote.js            # POST /quote
│   │   └── config.js           # GET /pricing-config  PUT /pricing-config
│   ├── services/
│   │   ├── vision.js           # Claude AI photo analysis
│   │   ├── quoteEngine.js      # Applies pricing config to AI line items
│   │   ├── storage.js          # S3 photo upload
│   │   └── secrets.js          # AWS Secrets Manager helper
│   └── db/
│       ├── client.js           # Postgres connection pool
│       └── migrations/
│           ├── 001_quotes.sql
│           └── 002_pricing_config.sql
├── .env.example
├── .gitignore
└── package.json
```

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/quote` | Accepts annotated JPEG, returns AI-generated line items and quote ID |
| `GET` | `/pricing-config` | Returns all active pricing rules |
| `PUT` | `/pricing-config` | Updates pricing rules (admin only) |

### POST /quote

**Request**: `multipart/form-data` with a single `photo` field containing the annotated JPEG

**Response**:
```json
{
  "quote_id": "uuid",
  "line_items": [
    {
      "service_code": "tree_removal",
      "description": "Oak tree removal",
      "qty": 20,
      "unit": "ft",
      "unit_price": 85.00,
      "total": 1700.00,
      "confidence": 0.88,
      "clarifying_question": null
    }
  ]
}
```

---

## Setup & deployment

### Prerequisites
- AWS account with CLI configured (`aws configure`)
- Node.js 20+
- PostgreSQL client (`psql`) for running migrations

### 1. Provision AWS resources (once)
```bash
chmod +x infra/setup.sh
./infra/setup.sh
```
Creates: S3 buckets, RDS Postgres t3.micro, Lambda function, API Gateway, IAM role, Secrets Manager entries.

### 2. Fill in secrets (after RDS is ready ~10 min)
```bash
aws secretsmanager update-secret \
  --secret-id field-quote/db \
  --secret-string '{"host":"YOUR-RDS-ENDPOINT","port":"5432","database":"fieldquote","user":"fieldquote","password":"YOUR-PASS"}'

aws secretsmanager update-secret \
  --secret-id field-quote/ai \
  --secret-string '{"anthropic_api_key":"sk-ant-..."}'
```

### 3. Run database migrations
```bash
psql postgres://fieldquote:PASS@YOUR-RDS-ENDPOINT/fieldquote \
  -f src/db/migrations/001_quotes.sql \
  -f src/db/migrations/002_pricing_config.sql
```

### 4. Add GitHub Actions secrets
In **Settings → Secrets → Actions**, add:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Every push to `main` automatically deploys the Lambda function.

### 5. Wire the frontend
Update the API URL in the frontend `index.html`:
```js
fetch('https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/prod/quote', ...)
```

---

## Local development

```bash
cp .env.example .env
# Fill in your local DB and API key values

npm install
node src/handler.js   # or use a local Lambda emulator such as aws-sam-local
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/JS + React (PWA, no App Store) |
| Camera | `getUserMedia` Web API — live rear viewfinder |
| Annotation | HTML5 Canvas — pen, arrow, text, eraser tools |
| Backend | AWS Lambda (Node.js 20) |
| API | AWS API Gateway (HTTP API) |
| AI vision | Anthropic Claude (claude-opus-4-6) |
| Database | AWS RDS Postgres 15 (t3.micro) |
| Photo storage | AWS S3 |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions |
| Frontend hosting | AWS S3 + CloudFront |
