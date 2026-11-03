# Deployment preparation

Set the canonical HTTPS APP_URL and Supabase public coordinates in Netlify Builds and Functions environment scopes. Configure exact Auth callback/recovery URLs in Supabase. Verify email confirmation, strong password policy, sessions, tenant isolation, private Storage and provider advisors before enabling customer access. Rotate any previously disclosed database password using the Supabase dashboard and store replacement credentials only in approved secure configuration.

The checked-in migration creates the application foundation; inspect existing hosted schema and migration history before applying it. Never blindly recreate tables or apply destructive changes.

Keep CONTACT_FORM_ENABLED and RESEND_SENDING_ENABLED false until their separately authorized stages. Contact form detection, consent/retention and a real hosted submission must be verified before enabling collection. No credentials belong in netlify.toml.

First public deployment is approval-gated. This source release is not evidence of a deployed site, verified inbox delivery, or a complete production LMS.
