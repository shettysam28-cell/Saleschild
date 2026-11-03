# Saleschild

Knowledge intelligence and learning platform in development.

## Local development

Use Node 24. Run `npm ci`, copy `.env.example` to `.env.local`, configure the Supabase URL and publishable key through environment management, then run `npm run dev`. Never use a service-role key in browser configuration.

## Validation

Run `npm run check`, `npm run build`, `npm run security:build`, `npm run security:repo`, and `npm run test:e2e`. System Chromium may be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Local policy tests are distinct from hosted Auth, RLS and Storage verification.

## Availability

Knowledge resources, version history, draft learning/workflow planning, notifications and organization settings form the foundation. Imports, AI processing, assessment delivery/grading and advanced analytics remain planned. Demo content is fictional. Email delivery remains disabled.

## Hosting

Netlify configuration is included. No automatic deployment job is configured. First public deployment requires explicit owner approval, completed security checks, correct authentication URLs and verified integrations. See [deployment notes](docs/DEPLOYMENT.md).
