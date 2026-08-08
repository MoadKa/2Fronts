# Follow-up mail: go-live runbook

Everything between "the code is merged" and "a real prospect gets a follow-up".

Nothing in this chain has ever sent a follow-up email. Read that as the good
news it is: the machine is built, tested and inert, and every step below is a
deliberate act rather than something that happened while nobody was looking.

Work top to bottom. Steps 1 to 3 are blockers in the strict sense — skip one and
the queue silently cancels everything it claims to do.

---

## 0. Before anything: the business registration

The dispatcher sends **commercial** email. Two rules make this non-optional:

- **§6 UWG** — the commercial character and the sender must be identifiable.
- **§5 DDG** — the sending party owes a valid Impressum.

The From line reads `{business_name} via 2Fronts`, and today "2Fronts" is not an
undertaking that legally exists. There is no wording that fixes that.

You also owe each coach an **Art. 28 DSGVO Auftragsverarbeitungsvertrag**,
because you process their prospects' data on their behalf. An AVV needs a legal
person to sign it. Note this gap is not created by this feature — 2Fronts
already processes visitor names and addresses today via `concierge_conversations`
— but the follow-up makes it visible from the outside.

Cost: roughly €26 and a form at the Gewerbeamt.

**The double-opt-in confirmation mail is exempt.** It carries no advertising, so
it is not kommerzielle Kommunikation. That is why steps 1 to 12 could ship and
run without this. The follow-up itself cannot.

---

## 1. The sending domain

GMX and WEB.DE together hold roughly half of German inboxes and both now require
authentication. Without it a real fraction of your mail is filed unseen.

- [ ] Verify a dedicated subdomain in Resend, e.g. `mail.2fronts.de`. Keep it
      SEPARATE from the domain your transactional mail uses, so a follow-up
      complaint cannot damage delivery of your own order notifications.
- [ ] Publish SPF, DKIM and DMARC for it. Start DMARC at `p=none` and read the
      reports for two weeks before tightening.
- [ ] Warm it up. A cold domain sending its first burst looks exactly like a
      spammer's first burst.

**Watch the complaint rate from day one.** Resend's AUP allows suspension at
0.08%. At 300 mails a month, ONE annoyed recipient is four times that number.
The fallback plan is AWS SES on an owned domain; `_shared/email.ts` already
takes an injected fetcher, so switching is a configuration change, not a rewrite.

---

## 2. The reply-to verification round-trip

`decideSend` cancels every row with `reply_to_unverified` while
`concierges.followup_reply_to_verified_at` is null.

This is deliberate. §5 DDG wants a *reachable* sender, and a coach typing an
address into a wizard proves neither that it exists nor that they read it. A
typo means their own customer's reply vanishes, in a mail carrying their name.

**The round-trip is now built** (`_shared/replyToVerifyMail.ts`,
`concierge-followup-verify-reply-to`, wired into `concierge-setup`). Saving the
sender panel mails the address a content-free confirmation link; clicking it is
the only thing that ever writes the column. The link's token binds the concierge
id AND a keyed digest of the address, and saving a different address clears the
stamp, so a verification cannot outlive the address it verified.

- [ ] Confirm the verification mail reaches a coach's reply-to and that clicking
      it stamps the column.
- [ ] Confirm that CHANGING the reply-to clears the stamp. A verification must
      never outlive the address it verified.
- [ ] Confirm `https://2fronts.de/absender-bestaetigen` resolves to the function
      and not to the SPA (`vercel.json` rewrite). A broken rewrite here means no
      coach can ever verify, and every queued mail cancels.

Until this works, the queue fills and cancels. Visibly — the reason is written
on every row — but it cancels.

---

## 3. Secrets

Runtime secrets (`supabase secrets set`, never in CI logs):

| Secret | What breaks without it |
|---|---|
| `RESEND_API_KEY` | dispatcher answers 503 |
| `FOLLOWUP_FROM_DOMAIN` | dispatcher answers 503 |
| `FOLLOWUP_SECRET` | dispatcher refuses to run at all |
| `FOLLOWUP_UNSUB_SECRET` | no unsubscribe link can be built, so nothing sends |
| `FOLLOWUP_PUBLIC_BASE_URL` | must be `https://2fronts.de`; anything else is refused |
| `CONSENT_CONFIRM_SECRET` | no consent can ever be confirmed |
| `FOLLOWUP_REPLY_TO_SECRET` | no reply-to can ever be verified, so every row cancels |
| `RESEND_WEBHOOK_SECRET` | bounces and complaints are dropped |

Repo Actions secrets, for the cron tick: `FOLLOWUP_DISPATCH_URL`,
`FOLLOWUP_SECRET`, `SUPABASE_ANON_KEY`.

- [ ] Point the Resend dashboard webhook at the `resend-webhook` function.
- [ ] Confirm `https://2fronts.de/abmelden` and `https://2fronts.de/bestaetigen`
      both resolve to the functions and not to the SPA. A broken rewrite means a
      dead opt-out link, which is the §7 UWG failure reached through ops.

---

## 4. The first live fire — you, to you

Do this with your own address on a concierge you own. Not a customer's.

```sql
update concierge_followup_ops set sending_enabled = true;
update concierges set followup_enabled = true where slug = '<your-own>';
```
```bash
supabase secrets set FOLLOWUP_SENDING=on
```

Then walk the whole chain and check each link, in this order:

1. Open `/c/<your-own>`, submit your name and your own address **with the box
   ticked**.
2. The confirmation mail arrives. Click it. The page confirms.
3. Check the ledger: one `granted` row, one `confirmed` row, both carrying the
   wording you actually saw on screen.
4. Reach the booking link. Check `concierge_followup_outbox` has exactly one
   `pending` row, scheduled two hours after the confirmation.
5. Run the tick by hand (Actions → Follow-up mail tick → Run workflow) rather
   than waiting. Before the two hours are up it should report `deferred`, not
   `sent`.
6. Wait out the delay, run the tick again. The follow-up arrives.
7. Click **unsubscribe** in it. Check a `visitor_unsubscribe` suppression row.
8. Run the tick once more. Nothing sends.

If any step surprises you, stop. `cancel_reason` on the outbox row names the
rule that fired, and the rules are in `concierge-followup-send/decide.ts` with
their reasoning attached.

---

## 5. Only then, a real customer

- [ ] One coach. One. Watch their first ten sends individually.
- [ ] Then read the number the whole plan is ordered around:

```sql
select
  count(*) filter (where action = 'confirmed')::float
  / nullif(count(*) filter (where action = 'granted'), 0) as confirm_rate
from concierge_consents;
```

Under about 25%, the follow-up reaches so few people that the sending half was
not worth building, and the honest move is to say so rather than defend it.

---

## The switches, in order of how fast they stop things

1. `update concierge_followup_ops set sending_enabled = false;` — instant, no
   deploy, stops every sender at the next claim.
2. `supabase secrets set FOLLOWUP_SENDING=off` — needs a moment to propagate.
3. `update concierges set followup_enabled = false where id = ...` — one coach.
4. Disable the scheduled workflow in the Actions tab — stops the tick entirely.

Reach for 1 first. It is the one that needs nothing from anyone else.
