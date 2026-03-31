# Unity Landscape App

A mobile-first field quoting application for landscaping and tree service crews. Field workers capture a site photo, annotate it on-site, and receive an AI-generated quote in seconds — all from a mobile browser with no app installation required.

---

## Live app

**Frontend**: https://don98042.github.io/unityLandscapeApp

---

## How it works

1. **Capture** — The field worker opens the app on their iPhone and uses the live rear camera viewfinder to photograph the job site
2. **Annotate** — Drawing tools let the worker mark up the photo: circles, arrows, and text labels (e.g. "Remove this tree", "Trim hedge")
3. **Analyze** — The annotated photo is uploaded to the backend where Claude AI identifies plants, estimates sizes, and determines what work is needed
4. **Quote** — AI line items are priced against a centralized config stored in the database
5. **Review & submit** — The worker adjusts quantities, resolves any flagged items, optionally applies a discount, and submits

---

## Architecture

```
iPhone (Safari PWA)
    │
    └── index.html — live camera viewfinder + annotation tools
         │
         ▼
    AWS API Gateway (HTTPS)
    https://sz2lrfueaa.execute-api.us-west-2.amazonaws.com/prod
         │
         ▼
    AWS Lambda (Node.js 22) — unity-landscape-api
         ├── vision.js        — sends photo to Claude AI for analysis
         ├── quoteEngine.js   — applies pricing config to AI line items
         └── storage.js       — saves annotated photo to S3
         │
         ├── RDS Postgres 15 (db.t3.micro) — unity-landscape-db
         │     ├── quotes             — quote records and status
         │     ├── quote_line_items   — individual line items per quote
         │     └── pricing_config     — centralized, admin-editable pricing rules
         │
         └── S3
               ├── unity-landscape-frontend  — static frontend assets
               └── unity-landscape-photos    — annotated job site photos
```

**Region**: us-west-2

---

## Pricing model

Three service types, all configurable via the pricing config table without code changes:

| Type | How it prices | Examples |
|---|---|---|
| `per_unit` | rate × quantity | Tree removal $85/ft, lawn mowing $0.04/sqft |
| `per_tier` | flat rate by size (small / medium / large) | Shrub trimming $25 / $45 / $70 |
| `time_based` | hourly rate × estimated hours | General labor $65/hr, 2-man crew $110/hr |

If the AI cannot identify the service type it falls back to `general_labor` and prompts the field worker to estimate hours.

---

## AI extraction rules

The vision model (Claude claude-opus-4-6) returns structured JSON only. Size estimation rules:

- **Trees**: height in 5-ft increments (10, 15, 20, 25, 30+)
- **Shrubs**: small (<3ft), medium (3–5ft), large (>5ft)
- **Hedges**: linear feet
- **Lawn/turf**: square feet
- **Unknown work**: flagged as `general_labor` with `confidence < 0.6` and a `clarifying_question` shown inline to the field worker

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
│   ├── handler.js              # Lambda entry point
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
├── index.html                  # Frontend — camera + annotation PWA
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

## AWS resources

| Resource | Name |
|---|---|
| Lambda function | unity-landscape-api |
| API Gateway | unity-landscape-api |
| RDS instance | unity-landscape-db |
| S3 frontend | unity-landscape-frontend |
| S3 photos | unity-landscape-photos |
| Secrets | unity-landscape/db, unity-landscape/ai |
| Region | us-west-2 |

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

### 2. Fill in secrets
```bash
aws secretsmanager update-secret \
  --secret-id unity-landscape/db \
  --secret-string '{"host":"YOUR-RDS-ENDPOINT","port":"5432","database":"fieldquote","user":"fieldquote","password":"YOUR-PASS"}' \
  --region us-west-2

aws secretsmanager update-secret \
  --secret-id unity-landscape/ai \
  --secret-string '{"anthropic_api_key":"sk-ant-..."}' \
  --region us-west-2
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

### 5. Deploy Lambda manually (first time)
```bash
npm install
zip -r function.zip src package.json node_modules
aws lambda update-function-code \
  --function-name unity-landscape-api \
  --zip-file fileb://function.zip \
  --region us-west-2
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/JS (PWA, no App Store) |
| Camera | `getUserMedia` Web API — live rear viewfinder |
| Annotation | HTML5 Canvas — pen, arrow, text, eraser tools |
| Backend | AWS Lambda (Node.js 22) |
| API | AWS API Gateway (HTTP API) |
| AI vision | Anthropic Claude (claude-opus-4-6) |
| Database | AWS RDS Postgres 15 (db.t3.micro) |
| Photo storage | AWS S3 |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions |
| Frontend hosting | GitHub Pages |

---

## Pending

- [ ] API key authentication on API Gateway
- [ ] Quote review UI (React) integration with live backend
- [ ] Admin pricing config UI
- [ ] PDF quote generation
