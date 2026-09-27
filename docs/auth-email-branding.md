# Auth Email Branding

Supabase Auth sends the sign-up confirmation, magic-link, password-recovery and invite emails for the bitXbit dashboard. By default these come from a generic Supabase address and template.

This guide makes the emails clearly from **bitXbit**.

## Quick win: set the sender name

1. Open your Supabase project dashboard.
2. Go to **Authentication → SMTP Settings**.
3. Set **Sender name** to `bitXbit`.
4. Save.

The emails will still be sent through Supabase's shared mailer, but the recipient will see **bitXbit** as the sender name.

## Production setup: custom SMTP (recommended)

For full control over deliverability and branding, send through your own domain:

1. Set up a transactional email provider — Resend, SendGrid, Mailgun, AWS SES, Postmark, etc.
2. Verify your domain (`bitxbit.com.au`) with the provider and add the required DNS records (SPF, DKIM, DMARC).
3. In Supabase, go to **Authentication → SMTP Settings** and toggle **Enable Custom SMTP**.
4. Fill in:
   - **Sender email**: e.g. `noreply@bitxbit.com.au` or `hello@bitxbit.com.au`
   - **Sender name**: `bitXbit`
   - **SMTP host**, **port**, **username**, and **password/API key** from your provider
5. Save and send a test email.

Recommended Resend settings:

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `noreply@bitxbit.com.au` |
| Sender name | `bitXbit` |

## Branded email templates

The HTML templates in `dashboard-app/supabase/templates/` give every auth email consistent bitXbit styling.

To apply them:

1. Open **Authentication → Email Templates** in Supabase.
2. For each template (Confirmation, Magic Link, Recovery, Invitation, Email Change), replace the body with the contents of the matching file:
   - `confirmation.html`
   - `magic_link.html`
   - `recovery.html`
   - `invite.html`
   - `email_change.html`
3. Save each template.

## Apply via Management API

If you prefer to script the SMTP settings, use the Supabase Management API:

```bash
export SUPABASE_ACCESS_TOKEN="your-access-token"
export PROJECT_REF="your-project-ref"

curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_email_enabled": true,
    "mailer_secure_email_change_enabled": true,
    "mailer_autoconfirm": false,
    "smtp_admin_email": "noreply@bitxbit.com.au",
    "smtp_host": "smtp.resend.com",
    "smtp_port": 587,
    "smtp_user": "resend",
    "smtp_pass": "your-resend-api-key",
    "smtp_sender_name": "bitXbit"
  }'
```

You can generate an access token at https://supabase.com/dashboard/account/tokens.
