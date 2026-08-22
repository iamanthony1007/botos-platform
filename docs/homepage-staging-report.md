# Homepage restructure, staging deploy report

Branch: `feat/homepage-restructure`, tip `33b6328`
Date: 2026-08-22
Staging preview: https://botos-platform-staging.pages.dev
Pages deployment: `26328761.botos-platform-staging.pages.dev`
Entry bundle: `index-Dn_T0J5E.js` (286 kB, gzip 87 kB)

Production gate for this branch: Nella's sign-off on the staging preview.
(Revised 2026-08-22 from Meta approval, because she needs the homepage live for
lead generation. The Meta-gated part was split out, see below.)

## What the branch carries

- Landing rebuilt to Nella's layout: existing hero (Join the Waitlist primary,
  Log in secondary, no Learn More), then the five-step flow strip, then the
  Without/With comparison. The page deliberately stops at the pre-existing
  copyright line until Nella says what closes it.
- `components/MarketingSections.jsx` and `lib/marketingCopy.js`: the strip and
  comparison as shared components. `HowItWorks.jsx` imports the same ones, so
  the two pages cannot drift. Copy is verbatim from the shipped HowItWorks
  sections; section headers are props for renames.
- `components/PublicHeader.jsx`, `lib/usePublicScroll.js`, the `index.css`
  public-scroll rules, and `pages/HowItWorks.jsx` (from `feat/how-it-works`).
- `App.jsx` lazy-loading split: logged-out visitors no longer download the
  authenticated app. Public entry bundle 1,149 kB down to 286 kB.
- `scripts/verify-deploy.mjs` scans the full chunk graph (the split moved
  createClient into the AuthContext chunk; the entry-only check failed a correct
  deploy).

## What was split OUT, to `feat/auth-restyle` (tip `bccf9b7`)

The restyles of Login, Waitlist, ForgotPassword and ResetPassword onto the
shared PublicHeader plus usePublicScroll. Those are the screens the Meta
reviewer signs in through, so they keep the Meta-approval gate with the
original reasoning. `feat/auth-restyle` branches off `feat/homepage-restructure`
because the restyles depend on PublicHeader and usePublicScroll; land the
homepage first.

Byte-identity after the split, blob hashes against main:

| file | main blob | branch blob | identical |
|---|---|---|---|
| Login.jsx | 8d8f4470 | 8d8f4470 | yes |
| Waitlist.jsx | cd49999a | cd49999a | yes |
| ForgotPassword.jsx | 3695b77b | 3695b77b | yes |
| ResetPassword.jsx | 73a60849 | 73a60849 | yes |

And the restyled copies on `feat/auth-restyle` are byte-identical to the
`feat/how-it-works` tip (11b81b6e, a493e724, c4fdf414, eee363d2).

## Verification on the live staging deploy

verify-deploy [staging]: scanned 15 JS files (entry + 14 chunks), expected ref
found in `AuthContext-d77slxN6.js` (1), wrong ref 0, OK.

Landing, read from the served page in a browser:

- Section order: hero, five-step strip (5 cards, 01 to 05), Without/With
  comparison (2 cards), copyright line. Nothing after the copyright line.
- Buttons, in DOM order: Log in, Join the Waitlist (header), Join the Waitlist,
  Log in (hero). No Learn More, no Get Started.
- Document scrolls (`public-scroll` class present, 1608 px tall in a 720 px
  viewport).
- Zero console errors.

Login, read from the served page: no sticky header, no `public-scroll` class,
buttons Sign In and Forgot password only. That is main's login page, which is
what the split must produce.

Link map, every public page: every `navigate` target (`/`, `/login`,
`/waitlist`, `/forgot-password`, `/dashboard`) is a registered route. Nothing
links to `/how-it-works` any more.

## Open

- Nella's answer on what closes the page, then her staging iteration (section
  headers are props; she is still adding sections).
- `/how-it-works` disposition, proposed in PROGRESS (keep live unlinked /
  redirect to `/` / keep as the long-form page). Not decided.
- Her three layout screenshots, still to be forwarded. The build maps her
  described order onto existing components; expect copy tweaks rather than
  structural ones.
