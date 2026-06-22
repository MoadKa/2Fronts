# Google OAuth Verification — Operator Guide

This document covers taking the Google OAuth app used by the **`google_sheets`
connector** through Google's verification process. The connector appends a
customer's incoming leads to a Google Sheet they own, which requires OAuth
access to that user's Google account.

> **Security note:** this file lists *env var names only*. Never paste client
> secrets, tokens, or webhook URLs into this repo. Secrets live in the Supabase
> edge-function environment, not in source.

---

## 1. Why verification is required

Google requires apps that request **sensitive or restricted scopes** to pass a
verification (and, for restricted scopes, a security) review before the OAuth
consent screen can be shown to the general public.

Until the app is verified it stays in **"Testing"** mode:

- Only accounts added as **test users** can complete the OAuth flow.
- Tokens for test users expire after **7 days**, forcing frequent re-consent.
- Unverified apps show a prominent "Google hasn't verified this app" warning.

So verification is what lets us onboard real customers without the warning
screen and without weekly token expiry.

---

## 2. OAuth consent screen config

Configure under **Google Cloud Console → APIs & Services → OAuth consent
screen**:

- **User type:** External (customers are outside our org).
- **App name:** 2Fronts (the customer-facing product name they will see).
- **User support email:** a monitored support address.
- **App logo:** required for verification; must match the homepage branding.
- **Developer contact email:** reachable; Google emails review updates here.
- **App domain:** homepage, privacy policy, and terms-of-service URLs (below).

---

## 3. Scopes requested + justification

Request the **minimum** scopes needed. We request two:

| Scope | Why we need it (one-line justification) |
| --- | --- |
| `https://www.googleapis.com/auth/spreadsheets` | Append incoming leads to the customer's own Google Sheet. |
| `https://www.googleapis.com/auth/userinfo.email` | Identify which Google account the customer connected (shown in their dashboard). |

**Why these are sensitive/restricted:**

- `auth/spreadsheets` is a **restricted** scope — it grants read/write to all of
  the user's Sheets, which Google treats as user data requiring the strictest
  review (and possibly an annual third-party security assessment).
- `auth/userinfo.email` is a **sensitive** scope — it exposes the user's email
  identity.

Each scope must have a clear justification and (for restricted scopes) a demo
video showing exactly how the app uses the data. Request only what the connector
actually uses; adding broader scopes (e.g. `auth/drive`) lengthens review.

---

## 4. Authorized domains + redirect URIs

Register under **OAuth consent screen → Authorized domains** and **Credentials →
OAuth 2.0 Client ID**:

- **Authorized domain(s):** the production apex domain (e.g. the domain behind
  `PUBLIC_APP_URL`). Privacy policy, homepage, and redirect URIs must all live
  on an authorized domain.
- **Authorized redirect URI(s):** the exact callback URL the OAuth flow returns
  to. This must match `GOOGLE_OAUTH_REDIRECT_URI` byte-for-byte (scheme, host,
  path, no trailing slash mismatch). Register one per environment
  (prod, and a staging/localhost URI for development if used).

A redirect-URI mismatch is the most common cause of `redirect_uri_mismatch`
errors — keep this value and the env var in lockstep.

---

## 5. Homepage + privacy policy requirements

Google verification will not pass without these, all on an authorized domain and
publicly reachable (no login wall):

- **Homepage URL** — explains what the app does; branding matches the consent
  screen (name + logo).
- **Privacy policy URL** — must explicitly state what Google user data is
  accessed (Sheets + email), how it's used (appending leads), how it's stored,
  and that it is **not** sold or used for ads. For restricted scopes, it must
  describe compliance with Google's Limited Use requirements.
- **Terms of service URL** — recommended; often requested during review.

---

## 6. Submission steps + timeline

1. Finish the consent-screen config (sections 2–5) and add the two scopes.
2. Add internal **test users** so the flow works while still in Testing.
3. Click **Publish app** → status moves to "In production / Pending
   verification."
4. **Submit for verification** and fill in the verification form: justify each
   scope, link the privacy policy, and (for the restricted `spreadsheets` scope)
   upload a **demo video** of the OAuth grant and the append-to-sheet flow.
5. Respond promptly to Google's follow-up emails (sent to the developer
   contact).

**Timeline (rough):** sensitive-scope review is typically days to ~2 weeks.
Restricted-scope review is longer and, if a security assessment is required for
`auth/spreadsheets`, can run **several weeks to a few months**. Plan launch
around this and keep onboarding limited to test users until it clears.

---

## 7. Environment variables (names only — never values)

The connector and OAuth flow read these from the edge-function environment:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` — must exactly match a registered redirect URI (§4).
- `CONNECTOR_TOKEN_KEY` — key used to encrypt stored connector OAuth tokens at rest.
- `ALERT_WEBHOOK_URL` — ops alerting webhook (e.g. notify on connector/provision failures).

> Set these in Supabase edge-function secrets, not in this repo. Do not log or
> commit their values.
