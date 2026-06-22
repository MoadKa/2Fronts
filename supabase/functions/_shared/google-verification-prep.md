# Google OAuth Verification — Fill-in-the-Blanks Prep

Companion to `README-google-verification.md`. That file is the *why/process*;
this is the *exact values + drafts* so submission is copy-paste. Nothing here is
a secret. Do the steps in your own Google Cloud Console — no agent can submit
this for you.

---

## A. OAuth consent screen — field values

Paste these into **APIs & Services → OAuth consent screen**:

| Field | Value |
| --- | --- |
| User type | External |
| App name | 2Fronts |
| User support email | _(your monitored support address)_ |
| App logo | _(upload 2Fronts logo — must match 2fronts.de branding)_ |
| Developer contact email | _(reachable address — Google emails review updates here)_ |
| App homepage | https://2fronts.de |
| Privacy policy URL | https://2fronts.de/privacy |
| Terms of service URL | https://2fronts.de/terms |
| Authorized domain | 2fronts.de |

## B. Scopes to add (the minimum — do not add more)

| Scope | Type | Justification (paste into review form) |
| --- | --- | --- |
| `https://www.googleapis.com/auth/spreadsheets` | Restricted | 2Fronts appends each incoming customer lead as a new row to a Google Sheet the customer owns and selects. Write access to that sheet is the core function the customer connects the integration for. |
| `https://www.googleapis.com/auth/userinfo.email` | Sensitive | Identifies which Google account the customer connected, shown back to them in their dashboard so they can confirm/disconnect the right account. |

> The `spreadsheets` restricted scope is what triggers the demo video + possible
> security assessment. There is no narrower per-sheet scope, so this is the
> minimum that works.

## C. Authorized redirect URI (must match byte-for-byte)

```
https://fettkrnajxbrfvwbenzf.supabase.co/functions/v1/google-oauth-callback
```

This must equal `GOOGLE_OAUTH_REDIRECT_URI` exactly. Register it under
**Credentials → OAuth 2.0 Client ID → Authorized redirect URIs**.

## D. Demo video shotlist (required for the restricted scope)

Record a screen capture (2–4 min, no edits needed) showing the real flow:

1. Land on the 2Fronts connect screen for a provision.
2. Click "Connect Google Sheets" → Google OAuth consent screen appears.
3. Show the requested scopes on the consent screen, grant access.
4. Return to 2Fronts → land on the confirm/mapping screen.
5. Pick a spreadsheet, show the column mapping.
6. Trigger/show a sample lead being appended as a new row in the actual Sheet.
7. Narrate one sentence: "2Fronts only writes incoming leads to the sheet the
   user selected; it does not read or modify other sheets."

> Note: step 5 (spreadsheet picker → `configure()`) is go-live seam #13 and is
> not wired yet. The video can only be recorded **after** that slice ships.
> This is the one hard dependency between verification and the coding work.

## E. Privacy policy — required content (host at /privacy)

Google will reject the submission if the privacy policy does not explicitly
cover all of these. Draft text:

> **Google user data.** When you connect Google Sheets, 2Fronts requests access
> to your Google Sheets (`spreadsheets` scope) and your Google account email
> (`userinfo.email` scope). We use Sheets access solely to append incoming leads
> as new rows to the specific spreadsheet you select. We use your email only to
> show you which Google account is connected.
>
> **Storage.** We store an encrypted OAuth token to keep the connection active.
> Tokens are encrypted at rest. We do not store the contents of your
> spreadsheets.
>
> **Limited Use.** 2Fronts' use of information received from Google APIs adheres
> to the Google API Services User Data Policy, including the Limited Use
> requirements. We do not sell this data, do not use it for advertising, and do
> not allow humans to read it except as required for security or to comply with
> law.
>
> **Revoking access.** You can disconnect at any time from your 2Fronts
> dashboard or via your Google account permissions page.

## F. Submission order

1. Ship seam #13 (spreadsheet picker → `configure()`) so the flow is recordable.
2. Host /privacy and /terms on 2fronts.de (public, no login wall).
3. Create the OAuth client + consent screen using sections A–C.
4. Add yourself as a test user, verify the flow end-to-end.
5. Record the demo video (section D).
6. Publish app → Submit for verification, paste justifications (section B),
   link privacy policy, upload video.
7. Watch the developer-contact inbox and respond fast.

**Critical path:** steps 1 + 2 gate everything; the Google review clock
(days to months for the restricted scope) only starts at step 6.
