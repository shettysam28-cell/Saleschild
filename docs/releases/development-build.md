# Isolated Phase 2.2 development build

Netlify uses `production` as a deploy context for a site's configured primary
branch. The development site's primary branch is `feature/issue-8-phase-2-2`;
that context does not identify the real Saleschild production website.

The existing `npm run build:netlify` command remains the only build path. Its
development allowance requires all of these inputs together:

- Netlify-provided `SITE_ID=a017f82c-55f3-48e9-8d36-d0863f0be2ea`.
- Exact branch `feature/issue-8-phase-2-2` and an exact commit SHA.
- Supabase URL `https://ebablvrbqbyctzzzmigc.supabase.co`, plus an active
  publishable key accepted by that development gateway. A prefix alone is not
  evidence that an opaque key belongs to the development project.
- The exact development origin for the current context: the primary
  `https://saleschild-development.netlify.app` origin for `production`, the
  PR #10 preview origin for `deploy-preview`, or the approved branch origin for
  `branch-deploy`.
- Explicit `false` values for `MEMBER_PROVISIONING_ENABLED`,
  `MEMBER_VERIFICATION_EMAIL_ENABLED`, `RESEND_SENDING_ENABLED`, and
  `CONTACT_FORM_ENABLED`.
- No privileged Supabase credentials or database connection settings; secret
  scanning stays enabled. Public settings belong in Netlify environment
  management, never local environment files or committed credentials.

Development publication waits for the successful `validate.yml` push workflow
for that exact repository, branch and commit. Lint, TypeScript, unit/database
tests, production build and artifact scans still execute in the Netlify build;
GitHub CI additionally includes both browser suites and the dependency gate.

The real production site `1d26223b-029f-41aa-ab43-0aed4f2c45e3` retains the
`main` branch, `production` context and exact-main push-CI requirements. There is
no environment toggle that selects the development allowance on that site.

On the separate development site only, its primary-site build needs public
coordinates and disabled flags in the `production` context. Settings limited
to `deploy-preview` are not available in that build. Its primary `APP_URL` must
match its primary HTTPS origin; the existing PR-preview contextual origin is
kept separate. Netlify team-login protection must cover all development deploys.

This change does not apply migrations, implement an Auth admin backend, enable
member provisioning, or establish authenticated hosted acceptance. The empty
development database still needs a separately reviewed baseline bootstrap.
