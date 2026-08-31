# Reply from the quotation tracker — where this ended up

Supersedes our earlier reply, which asked for two things and described a frame.
Both asks were answered, everything is built, and the board has been using it.
One thing changed shape on our side after we saw it working, and this is written
so you are not maintaining an integration we no longer have.

**In one line: we do not frame the report any more. We open it in its own tab
with `#t=<grant>`, and that is the whole of it.**

---

## 1. What the board does

Left rail of the report, under **Under contract**, beside Contracts:

```
🔧 HVAC records ↗
```

They press it. A tab opens, the archive is there, no passcode. That is the
entire interaction, and it is what they asked for.

---

## 2. What we build to make that happen

On the press, before anything else, we open the tab — synchronously, or a popup
blocker eats a tab opened after an `await`. It holds "Opening the service
records…" for the moment the round trip takes. Then our Cloud Function mints one
grant and we point the tab at:

```
https://mcm.web.app/#t=<grant>
```

The grant is exactly your §6, and is minted fresh per press — never cached,
which would defeat single use.

We verified the format against a second implementation written from your prose
rather than from our minting code, since that is the only way such a check means
anything. Both readings accept a valid grant and both reject: the wrong secret,
a **hex-decoded** secret, a signature taken over the **raw JSON** instead of the
transmitted base64url string, and a payload with one byte changed. Those are the
two details you asked to pin down, and they are pinned.

Nothing is cached and no credential is durable on our side. The signing secret
lives in a config document no client may read, is written only through the same
function, and is set from our own settings screen — never the Firestore console,
which reads values back onto a screen.

---

## 3. Who is allowed to ask for a grant

The same right to read the report, proved whichever way the reader has it:

| Reader | Firebase identity | How the grant is authorised |
|---|---|---|
| Property manager | Google, on an allowlist | checked against the editor list |
| Director on the board list | Google | checked against the board list |
| Everyone else on the board | none | their tracker passcode, re-verified |

That third row is why your original §5b — a Firestore document behind
`request.auth` — would not have worked here, and your correction of it stands.

---

## 4. What we stopped using, and why

**The frame.** It worked. We removed it anyway, for your reasons and one of our
own:

- In its own tab the archive has the whole screen for a two-pane application.
- It prints. Framed, it cannot — you have no print stylesheet, and a frame
  prints as a grey rectangle.
- The session survives. Safari partitions storage for third-party frames, so a
  framed sign-in is unreliable across visits in exactly the browser most of this
  board uses.
- **Ours specifically:** this report rebuilds its whole DOM on every inline edit.
  An embedded frame reloads with it, losing the reader's place and re-prompting,
  every time the manager corrects a price. We had worked around that by loading
  the frame only on a press. Removing the frame removed the workaround too.

**The embed-only passcode.** Unused. It only ever had meaning inside a frame —
`#t=` takes a grant and nothing else. You may retire ours whenever it suits you;
we will not notice. We have taken the field for it out of our settings screen so
nobody pastes a credential that does nothing.

**The `postMessage` channel.** We no longer listen for `ready`, `needs-unlock`
or `error`, and we send nothing. With no frame there is nothing on the other end
of it. Your `frame-ancestors` entries for us are unused but worth keeping — if
we ever want the frame back it is a small change here and none there.

---

## 5. What would break this, and what we would need

- **You rotate the signing secret.** Send us the new one; it goes in the settings
  screen and takes effect immediately. Nothing redeploys.
- **We move domain.** Only matters if we frame again, since a link needs no
  origin permission. We would tell you anyway.
- **You change the grant format.** Tell us and we will follow — it is one
  function on our side.

If a reader's grant cannot be minted — no secret stored, our function down —
the tab still opens, at a clean `https://mcm.web.app/` with nothing in the
fragment, and your passcode form does its job. ⌘-click gets the same. Nobody is
stranded and nobody sees a broken URL.

---

## 6. Two small things from using it

- **Erasing the fragment before the exchange, not after, was the right call.**
  We could see it in the address bar for the instant before it went; you had
  already thought about it.
- **The `hashchange` case is real.** A director with the archive already open
  pressed the link again and it worked, which it would not have if you had only
  read the fragment on load.

---

## 7. Checklist, closed

- [x] Framing locked to our origins (unused now, kept)
- [x] Beta origin allowed — used while staging, before directors saw it
- [x] Embed-only passcode issued — **not used, retire at will**
- [x] Signing secret issued, stored, and minting verified against your spec
- [x] New-tab link carrying `#t=<grant>` — **this is the integration**
- [ ] ~~`#secHVAC` section holding the frame~~ — removed
- [ ] ~~Unlock the frame from the tracker~~ — no frame
- [ ] Optional, not taken: deep links (`#timeline`, `#suite=…`, `#ask=…`). If
      the board starts asking for one view in particular we will add menu
      entries carrying both the grant and the view fragment — tell us how you
      would like the two combined in one URL and we will follow.

Thank you for the `hashchange` handling and the five-second grace. Both were
things we would have found the hard way.
