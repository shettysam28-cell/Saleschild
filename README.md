# Saleschild

Knowledge intelligence and learning platform in development.

## Local development

Use Node 24. Run `npm ci`, copy `.env.example` to `.env.local`, configure the Supabase URL and publishable key through environment management, then run `npm run dev`. Never use a service-role key in browser configuration.

## Validation

Run `npm run check`, `npm run build`, `npm run security:build`, `npm run security:repo`, `npm run test:e2e`, and `npm run test:import:e2e`. System Chromium may be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Local policy tests and synthetic-account browser fixtures are distinct from hosted Auth, RLS and Storage verification.

## Availability

Knowledge resources, company-defined CSV/XLSX and DOCX imports, version history, administrator approval, approved-source lessons in existing Learning Paths, draft workflow planning, notifications and organization settings form the foundation. See the [Universal Knowledge Gateway release notes](docs/releases/universal-knowledge-gateway.md) for supported formats, limits and verification evidence. AI processing, assessment delivery/grading, assignments and advanced analytics remain planned. Demo content is fictional. Email delivery remains disabled.

## Hosting

Netlify builds the production branch after its matching GitHub CI run passes. Database migrations use a separate controlled workflow; website builds do not apply them. Releases require owner authorization, completed security checks and correct authentication URLs. See [deployment notes](docs/DEPLOYMENT.md).
