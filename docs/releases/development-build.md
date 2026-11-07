# Isolated Phase 2.2 development build

Current acceptance: [hosted development Member evidence](development-member-provisioning.md). The reviewed Edge backend and paired member flags are enabled on this isolated site for controlled development use after the supported hosted Auth/session tests passed. Full production release gates remain closed.

Netlify uses `production` as a deploy context for a site's configured primary
branch. The development site's primary branch is `feature/issue-8-phase-2-2`;
that context does not identify the real Saleschild production website.

The existing `npm run build:netlify` command remains the only build path. Its
development allowance requires all of these inputs together:

- Netlify-provided `SITE_ID=a017f82c-55f3-48e9-8d36-d0863f0be2ea`.
- Exact branch `feature/issue-8-phase-2-2` and an exact commit SHA. For normal
  primary/branch builds this is `BRANCH`; PR previews must instead have
  `HEAD=feature/issue-8-phase-2-2`, `PULL_REQUEST=true`, and `REVIEW_ID=10`.
  Netlify defines `BRANCH` as the checkout reference and `HEAD` as the source
  branch, so a preview checkout reference must not be mistaken for its source.
- Supabase URL `https://ebablvrbqbyctzzzmigc.supabase.co`, plus an active
  publishable key accepted by that development gateway. A prefix alone is not
  evidence that an opaque key belongs to the development project.
- The exact development origin for the current context: the primary
  `https://saleschild-development.netlify.app` origin for `production`, the
  PR #10 preview origin for `deploy-preview`, or the approved branch origin for
  `branch-deploy`.
- Matching member flags: default both `MEMBER_PROVISIONING_ENABLED` and
  `MEMBER_VERIFICATION_EMAIL_ENABLED` to `false`; paired `true` values require
  `MEMBER_AUTH_BACKEND=supabase-edge-development` and the verified development
  backend, Auth callbacks and security gates. `RESEND_SENDING_ENABLED` and
  `CONTACT_FORM_ENABLED` must remain explicitly `false`.
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
coordinates and the reviewed paired member flags in the `production` context. Settings limited
to `deploy-preview` are not available in that build. Its primary `APP_URL` must
match its primary HTTPS origin; the existing PR-preview contextual origin is
kept separate. Netlify team-login protection must cover all development deploys.

The initial build fix did not initialize the database or activate members. The
subsequent approved development bootstrap, reviewed SQL, Supabase-managed Edge
backend and supported hosted Owner/Member tests are recorded in the linked
acceptance report. They do not authorize production migrations or deployment.
