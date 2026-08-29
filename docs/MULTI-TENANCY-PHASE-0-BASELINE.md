# Multi-Tenancy Phase 1: Phase 0 Live Baseline

The authoritative state read, run by Anthony 2026-08-29 in both SQL editors via
`db/phase0_state_read.sql`. Production `rydkwsjwlgnivlwlvqku` at 20:13:23Z,
staging `hlpucysbaqerhwahfolg` at 20:14:39Z. Read-only.

This file records what the probe returned, corrects three things I got wrong in
`docs/MULTI-TENANCY-PHASE-0-REFRESH.md`, and lists the decisions that now gate
the migration design.

---

## 0. Lead finding: a live anon hole on production, unrelated to Phase 1

**`conversation_examples` is readable and writable by anyone holding the public
anon key, right now, on production.**

The mechanism, from the probe:

```
table:  conversation_examples
policy: "Service role full access"
cmd:    *  (ALL)
roles:  [PUBLIC]        <-- not service_role
using:  true
check:  true
```

The policy was named for `service_role` but created without a `TO service_role`
clause. A policy with no `TO` clause applies to **PUBLIC**, which includes
`anon`. Production separately grants `anon` the full set (SELECT, INSERT,
UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on that table. Grant plus
permissive policy equals access.

The anon key is public by design: it ships in the dashboard bundle served from
getmu.co and it is committed in `sales-bot/wrangler.toml:19`. So the audience
for this is anyone who has viewed the site or the repo.

What is exposed: `conversation_examples` holds real coaching conversation
transcripts. `Tester.jsx:41-45` reads `contact_name`, `outcome`, `turns` and
friends with `.limit(648)`, which is the scale. Contact names and full message
turns. Readable, and because the policy is `ALL`, also **deletable**.

The bitter detail: the 2026-08-07 audit called `conversation_examples` "the one
correctly-scoped table" and made it the template for migration 011. Its two
scoped policies ("Admins read examples", "Clients read examples") are indeed
correct. They are simply irrelevant, because policies are OR'd and this third
one returns true for everyone. That is precisely the failure the 011 draft's own
comment warns about, already present in the table being used as the model.

### Proposed immediate fix, independent of 011

```sql
drop policy "Service role full access" on public.conversation_examples;
```

One statement. It is tighten-only: it can remove access, never add it.

Why it is safe:
- `service_role` has `rolbypassrls = true` on production (confirmed by the
  probe), so the Worker never needed this policy.
- The only dashboard reader is `Tester.jsx`, which runs as `authenticated` and
  is covered by the two surviving scoped policies.
- Nothing in `dashboard/src` writes to this table. The single `.from(
  'conversation_examples')` call in the codebase is that one read.
- After the drop, `anon` matches no policy and gets zero rows, and the two
  remaining policies both pivot on `auth.uid()`, which is null for anon.

Rollback, if it ever mattered, is recreating the policy from the text above.

This does not fit the staging-first rule in a useful way, because staging has
RLS **off** on that table and 0 policies, so there is nothing there to rehearse
against. My recommendation is to run it on production on its own, verify with
one anon probe, and let 011 land afterwards. Your call, and I will not run it.

### Second, smaller PUBLIC problem: `invites`

```
policy: "Anyone can accept their own invite by token"
cmd:    UPDATE
roles:  [PUBLIC]
using:  (status = 'pending')
check:  (status = 'accepted')
```

No `auth.uid()` anywhere in it. Any anon caller can flip **any** pending invite
to `accepted`, burning it before the intended recipient uses it. No data is
read, so this is denial of onboarding rather than disclosure. Currently zero
pending unexpired invites exist, so nothing is live. Fold into 011.

---

## 1. Corrections to my Phase 0 refresh

Three things in `MULTI-TENANCY-PHASE-0-REFRESH.md` were wrong. Stated plainly
so the refresh is not read at face value.

### C1. There is no Bombers Blueprint organization. Draft Part 1a is still needed.

I called Part 1a "the single most dangerous stale line in the file" on the
briefing's statement that Bombers Blueprint was already an org. It is not. The
probe returns three organizations:

| org id | org name | bot |
|---|---|---|
| `00000000-...-000000000001` | Nella Platform | Bombers Blueprint (`...002`) |
| `c854fd89-7e7e-4b32-aaf8-f5daa1dfb082` | SuperYOU | SuperYOU - Laura Phillips (`45b776e3-ee4f-461d-a526-4249d18757b3`) |
| `00000000-...-0000000000d0` | Mu AI Demo | Mu AI Demo (`...00d1`) |

The briefing's org list conflated bot names with org names. Bombers Blueprint is
a **bot**, still sitting under the platform org, exactly as the draft described
in August. Part 1a survives. It needs one change: made idempotent, so a re-run
in the chunked shape cannot create a duplicate org.

### C2. `invites` RLS is ON, with five policies. The hole is a deliberate anon policy.

I predicted RLS was off. It is on. The exposure is real but the mechanism is
different:

```
policy: "Anyone can read invite by token"
cmd:    SELECT
roles:  [anon]
using:  (status = 'pending' AND expires_at > now())
```

There is no token predicate, because RLS cannot see a query's WHERE clause. So
this permits **listing every pending unexpired invite, tokens included**, not
just fetching one by token. An invite row carries `token`, `role` and
`assigned_bot_id`, and `AcceptInvite.jsx:90-100` upserts those straight onto a
new profile. That is a tenant-and-role selection primitive for anyone with the
anon key.

Not currently live: `pending_unexpired = 0`. It arms the moment an invite is
created.

The policy cannot simply be dropped: `AcceptInvite.jsx:27` **needs** it, and
onboarding breaks without it. Section 3 covers the options.

### C3. The AcceptInvite regression risk I raised is closed. It cannot happen.

I worried that enabling tenant-scoped policies on `bots` would break
`AcceptInvite`'s embedded `bots (name)` read, which runs as anon. It cannot,
because that embed **already returns nothing today**: `bots` has RLS on with
both policies scoped `TO authenticated`, so anon already matches nothing. The
page works in that state today, so 011 changes nothing for it. Withdraw the
concern. Keep the end-to-end invite test in the matrix anyway, for the `invites`
change rather than the `bots` one.

---

## 2. What the probe settles

### Table inventory: clean, no surprises

Sixteen tables in `public` on both environments, exactly the set the refresh
predicted. **No out-of-band table exists.** N-4 closed.

### Production RLS: unchanged since 2026-08-07, and now fully mapped

38 policies. Every core table carries `authenticated` `USING (true)` as before.
Newly visible beyond the 2026-08-07 snapshot: `invites` (5 policies, above) and
`conversation_examples` (3, one broken). `connected_accounts` and
`data_deletion_requests` both RLS-on with zero policies. `waitlist_applications`
keeps its two 010 policies with the `authenticated` grant revoked, exactly the
state `014_rollback.sql` documents. Confirms refresh finding S2: leave it alone.

`audit_log` confirms the draft's read: `"Authenticated can insert audit_log"`
with `WITH CHECK (true)`. Any signed-in user can forge audit entries.

### `service_role` has BYPASSRLS on both. N-5 closed.

`f_helpers` is empty on both, so no leftover functions from a prior attempt.

### Staging grants do NOT match production. The dress rehearsal is not faithful yet.

| | production | staging |
|---|---|---|
| `anon` grants | full set on 14 tables | **none anywhere** |
| `authenticated` grants | full set incl. DELETE | INSERT, SELECT, UPDATE only |
| `authenticated` on `organizations` | full set | SELECT only |
| `connected_accounts` | anon + authenticated granted, RLS denies | service_role only |

Two consequences that will otherwise be misdiagnosed during the rehearsal:

1. **`bot_documents` DELETE will fail on staging and succeed on production**,
   for grant reasons, not policy reasons. The Documents page remove button is
   the affected path. Without knowing this in advance we would read it as an
   RLS bug and go looking in the wrong place.
2. **Nothing anon-related can be rehearsed on staging at all**, because anon has
   no grants there. That includes both PUBLIC findings above. Anon behaviour is
   production-only to verify, read-only, by probe.

Staging's posture is the safer one and is the better end state. That is a design
question for Section 3, not something to "fix" by loosening staging.

---

## 3. The decisions this creates

### D1. Superadmins would lose their dashboard under the draft. This is the big one.

Not an RLS lockout. An application-logic one, and the draft walks straight into
it.

`botHelper.js:14-20`: for admin and superadmin, `getAssignedBot` resolves the
bot by `.eq('organization_id', profile.organization_id).single()`, and only
falls through to `assigned_bot_id` when `organization_id` is falsy.

Today both superadmins have `organization_id = null`, so they fall through to
`assigned_bot_id = ...002` and land on Bombers Blueprint. That is why their
dashboards work.

The draft's backfill sets `superadmin -> organization_id = ...0001` (Nella
Platform). Part 1a has meanwhile moved Bombers **out** of `...0001` into the new
Bombers org. So `...0001` ends up holding zero bots, and `.single()` on zero
rows errors, returns null, and `getAssignedBot` yields null.

Every page calls it. Inbox, Analytics, Settings, Documents, PromptEditor,
TrainBot, Connections. **Anthony and Nella both lose the entire dashboard**, in
the silent blank-page way, at the moment the backfill chunk runs.

Staging will reproduce this faithfully: `thony@gmail.com` is superadmin with
`organization_id = ...0001`, which holds `Bombers Blueprint (staging)`. Expect
the rehearsal to break exactly here. That is the rehearsal working.

**Recommendation: leave superadmin `organization_id` NULL.** Every superadmin
branch in the policy set goes through `auth_is_superadmin()`, which reads
`role`, never the org. No policy needs a superadmin to have an org. Leaving it
null means `getAssignedBot` keeps falling through to `assigned_bot_id` and the
two superadmin dashboards are byte-for-byte unchanged by this migration.

It requires one adjustment: the backfill gate becomes "zero nulls among active
**non-superadmin** profiles" rather than "zero nulls among active profiles".

The alternative, giving superadmins the Bombers org so their UI still resolves,
couples the platform owner to a client tenant and breaks again the moment a
third client arrives. Not recommended.

### D2. The draft's abort gate would have fired. Confirms refresh finding S6.

Production has 7 profiles with a null org, but 2 of them (Lou, Abigail) are
`disabled = true`. The draft's gate counts all nulls and raises, so **the draft
as written aborts on this exact data**. The `disabled = false` filter in the
refresh is not hypothetical tidiness, it is required.

Active profiles needing a backfill, after D1 removes the two superadmins: three.

| profile | role | assigned bot | target org |
|---|---|---|---|
| ornellakuate@gmail.com | client | `...002` | new Bombers org |
| shaun@fairwayperformance.com | client | `...002` | new Bombers org |
| austinewebdev@gmail.com | setter | `...002` | new Bombers org |

`meta-review@getmu.co` already has `organization_id = ...00d0` and needs
nothing. Lou and Abigail are disabled; backfill them anyway for hygiene, but
never let them gate.

Staging needs no backfill at all: `h_active_profiles_null_org` is empty there.

### D3. Nella is not connected to SuperYOU in any way. Part B is blocked on this.

Her profile: `role = superadmin`, `organization_id = null`, `assigned_bot_id =
00000000-...-000000000002`, which is **Bombers Blueprint, Coach Shaun's bot**.

The SuperYOU tenant has **zero profiles**. Laura Phillips has no login. Nobody
is attached to that org.

So if Nella opens Connections today, or after 011 under the D1 recommendation,
the page resolves to Bombers Blueprint and the Connect button would attach her
Instagram account to **Coach Shaun's tenant**. That is the worst available
outcome for Part B and it is the current default.

The briefing's "superadmin covers her" is true for RLS and false for the UI:
`getAssignedBot` pins every user to exactly one bot regardless of role.

Options, in preference order:

- **(a) Point her at SuperYOU for the connect.** One row:
  `assigned_bot_id = 45b776e3-ee4f-461d-a526-4249d18757b3`, org left null.
  Reversible, no code change, and her dashboard then shows the tenant she is
  connecting. Cost: she loses one-click sight of Bombers in the UI while it is
  set, though RLS still permits her everything.
- **(b) Give SuperYOU its own client profile** and have that account do the
  connect, leaving Nella on the platform view. Cleaner long term, matches how
  client number three would onboard, but it is a new account and an invite,
  which drags in the `invites` decision below.
- **(c) Build a bot switcher for superadmins.** The correct end state. Out of
  scope here and not worth blocking Part B on.

Recommend (a) for this cycle, (c) recorded as the real fix.

Good news on the rest of briefing 6.1 and 6.2, all confirmed from the probe:
`auto_send_enabled = false` and `stage_automation = {}` on the SuperYOU bot, so
automation is locked. Her `connections` permission is fine: `permissions` is
null but `AuthContext.can()` short-circuits true for superadmin. And the
SuperYOU prompt is **not** a placeholder, 3614 characters of real business
content (Jumpstart Sessions, Singapore, SGD pricing, executive avatar).

One flag that is not this phase but bears on "before real leads flow": the
Worker's `buildDeveloperPrompt` still hardcodes Bombers Blueprint golf framing
on every call, so a SuperYOU lead would get a bot told it represents a golf
coach, regardless of that good prompt. Product readiness, recorded, out of
scope for 011.

### D4. `invites`: pick one

The anon SELECT policy is load-bearing for onboarding and over-broad by nature.

- **(a) Leave it, document it.** Zero risk to onboarding. Keeps a listable
  token store armed whenever an invite is pending. Operationally survivable
  given invites are rare and short-lived.
- **(b) Replace with a `SECURITY DEFINER` lookup RPC** taking the token as an
  argument, then drop the anon SELECT policy. Correct fix, closes it properly.
  Costs a small `AcceptInvite.jsx` change, which briefing 4.6 excludes ("no
  dashboard feature changes"), so it needs your explicit waiver.
- **(c) Split the difference:** take (a) now, keep 011 scoped as briefed, and
  book (b) as the immediately-next item.

Recommend **(c)**. It keeps this phase's blast radius where the briefing put it,
and the exposure is genuinely dormant at zero pending unexpired invites.

Regardless of choice, fix the PUBLIC UPDATE policy from Section 0 inside 011:
re-scope it so it cannot be used to burn a pending invite.

### D5. Should production's anon grants be revoked?

Production grants `anon` the full privilege set on 14 tables. RLS is what stops
it, which is exactly the single-layer posture that let the
`conversation_examples` policy become an exposure instead of a near-miss.
Staging already has zero anon grants and is unharmed.

Not in the briefing's scope and not required for tenant isolation. Worth a
decision as defence in depth, because a revoke would have contained Section 0's
finding to nothing. If you want it, it belongs in its own migration after 011
lands, with `invites` keeping its anon SELECT grant if D4 lands on (a) or (c).

---

## 4. Migration shape, now confirmed against real data

Unchanged from the refresh: 12 target tables, `waitlist_applications` out,
numbered idempotent chunks, verification SELECT after each, rollback alongside.

Confirmed additions from this baseline:

1. Part 1a stays, made idempotent (guard the org insert on name).
2. Backfill excludes superadmins entirely (D1) and gates on `disabled = false`
   (D2).
3. `conversation_examples` gets its policies dropped and rebuilt like every
   other table. The drop-by-iterating-`pg_policy` loop the draft already uses
   handles the broken PUBLIC policy without needing to name it, which is the
   loop earning its keep.
4. `invites` enters the target list at least for the PUBLIC UPDATE fix.
5. Staging chunk zero: align the `authenticated` grants to production, or
   accept and annotate the two divergences in D-section "Staging grants" so the
   matrix reads correctly.

Expected end state per table gets written into the file as the verification
output before anything is pasted.

---

## 5. Open items, updated

| id | Item | Status |
|---|---|---|
| N-1 | Does a Bombers Blueprint org exist | **CLOSED.** No. Part 1a required |
| N-2 | `invites` state and decision | Mechanism known. Decision D4 open |
| N-3 | Nella and SuperYOU | **CLOSED as a question, open as decision D3.** No link exists |
| N-4 | Out-of-band tables | **CLOSED.** None |
| N-5 | `service_role` BYPASSRLS | **CLOSED.** True on both |
| N-6 | 014 file unexecuted on production | Still outstanding, bookkeeping |
| N-7 | `/meta/oauth/start` unauthenticated | Open, scope decision |
| N-8 | Realtime under new policies | Open, matrix row |
| N-9 | `conversation_examples` PUBLIC ALL policy | **NEW, live. Decision needed now** |
| N-10 | `invites` PUBLIC UPDATE policy | **NEW.** Fold into 011 |
| N-11 | Staging grants differ from production | **NEW.** Affects rehearsal fidelity |
| N-12 | Superadmins lose dashboard under draft backfill | **NEW.** Decision D1 |
| N-13 | Production anon grants as defence in depth | **NEW.** Decision D5 |
| O-2 | `SYSTEM-AUDIT.md` missing | Still open |

---

*End of baseline. No SQL was executed from the Claude session; both outputs were
produced by Anthony in the Supabase editors and pasted back. Decisions D1
through D5 and the Section 0 fix gate the migration draft.*
