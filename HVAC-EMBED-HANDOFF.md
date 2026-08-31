# Reply from the quotation tracker

Your §5b is built and deployed on `https://quote-report.web.app`. The board is
meant to unlock the tracker once and never see a second prompt, and every part
of that is in place except one value, which only you can issue.

**The ask, in one line: send an embed-only passcode for the tracker to hold.**

---

## 1. What is already done on this side

- `#secHVAC` section and a **🔧 HVAC records** entry in the report's left rail.
- The frame: `https://mcm.web.app/?embed=1`, `allow="microphone"`, no sandbox,
  `height:80vh; min-height:600px` (`72vh`/`520px` under 600px wide).
- **The section is drawn only on `https://quote-report.web.app`.** Everywhere
  else — our beta site, our other four buildings — there is no section and no
  menu entry, because your `frame-ancestors` would refuse the frame there and
  the board would be looking at an empty box with nothing to explain it. We
  check `location.origin` against a one-item list.
- We listen for `ready`, `needs-unlock` and `error`. `ready` replaces the
  section's description with your entry count and date range.
- On `needs-unlock` we post `{type:'unlock', passcode}` to `https://mcm.web.app`
  — targeted, never `'*'`.
- Frame loads on a press, not with the page. Ours redraws its whole DOM on every
  inline edit, which would reload your frame and lose the reader's place each
  time the manager corrected a price.
- The section is hidden from print, since you have no print stylesheet. The
  "Open full screen ↗" link is beside the heading.

Verified with 30 unit tests: the origin gate, the frame markup, and the unlock
exchange including the refusal and no-code paths.

---

## 2. What we need from you

### (a) An embed-only passcode — the one blocker

You offered this and we would like to take it: a code that is **not** the one the
board types at `mcm.web.app` directly, so either can be rotated without
disturbing the other. Send it however you would send a credential; it goes
straight into our config and is never quoted back.

Until it arrives, the frame shows its own form after the five-second grace — so
the integration degrades exactly as you designed it, and nobody is stranded.

### (b) Optionally, our beta origin

`https://quote-report-beta.web.app`. We stage everything there before it reaches
directors, and today we cannot see this working until it is already live.

```
make embed-allow ORIGIN="https://quote-report.web.app https://quote-report-beta.web.app"
```

---

## 3. Where the code lives, and why not where you suggested

Your §5b recommends a Firestore document readable by a signed-in tracker user.
**That would have locked out most of our board.**

Our readers are three populations, and only two of them are signed in:

| Reader | Firebase identity | How they read the report |
|---|---|---|
| Property manager | Google, on an allowlist | Firestore directly |
| Director on the board list | Google | Firestore directly |
| **Everyone else on the board** | **none** | shared passcode → Cloud Function |

The third group is the majority and the reason the passcode exists. A rule on
`request.auth` serves two managers and refuses eleven directors.

So the code is served by our gate function, which is the one thing every reader
passes through:

- **Passcode reader** — handed the code by the same call that returns the
  report. Answering the passcode *is* the proof; no second check is needed.
- **Signed-in editor or director** — asks for it by name; the function checks
  the caller against the same two lists our Firestore rules use.
- **Neither** — nothing is returned, and your form appears.

The code is **never in our JavaScript**. It is stored in a config document that
no client may read (`allow read: if false`), written only through that function,
and set from the report's own settings screen rather than the Firestore console
— a console reads values back onto a screen, which is how a set of API keys
ended up in a screenshot here last week.

You can confirm the first half of that claim yourself:

```
curl -s https://quote-report.web.app/ | grep -c hvacEmbedCode    # 0
```

---

## 4. Optional: a signed token instead of a shared code

Not needed for launch — take this only if you would rather no reusable secret
existed. A static code, however well kept, is a credential in circulation: any
reader who can pass our gate can in principle extract it from the exchange and
use it against your site directly, un-framed, for as long as it lives.

We can offer instead, from our Cloud Function:

```
{ v: 1, iat: <unix>, exp: <iat + 300>, aud: "mcm.web.app", nonce: <random> }
```

HMAC-SHA256 over the compact JSON with a secret shared once between our function
and yours, sent as `{type:'unlock', token: '<base64url payload>.<sig>'}`.

Your side verifies the signature, that `exp` is in the future, and that the
nonce has not been seen. A leaked token is dead in five minutes and cannot be
replayed. If you would accept that shape, say so and we will mint it; if you
would rather define the payload, send yours and we will produce it.

The stronger form — a Firebase custom token minted by us and accepted by your
project — is the textbook answer, but it needs cross-project trust configured on
your side and is almost certainly more than this warrants.

---

## 5. What we deliberately do not do

- **No copy of your data**, no proxy, no re-host. The frame is the integration.
- **Nothing is posted to the frame except `unlock`.** No navigation, no `ask`.
  If we later add menu entries for `#timeline` or `#suite=…` we will use
  `postMessage` rather than resetting `src`, as your §4 recommends.
- **We never send `unlock` to any origin but yours**, and we ignore any message
  that does not come from `https://mcm.web.app` carrying `source: 'nnsc-hvac'`.
- **We do not attempt to read anything out of the frame.** Cross-origin, and not
  our business.

---

## 6. How to check it from your side once the code is issued

1. Open `https://quote-report.web.app`, unlock with the board passcode.
2. Left rail → **🔧 HVAC records** → *Open the service records*.
3. Expected: your "Opening the service records…" line, then the report. The
   passcode form should never appear.
4. If it does appear, the code has not been saved on our side yet — tell us and
   we will check the setting rather than sending you chasing it.

Anything about the tracker — how a reader is admitted, what the gate returns,
why the section is hidden on our other sites — ask and we will answer or change
it.
