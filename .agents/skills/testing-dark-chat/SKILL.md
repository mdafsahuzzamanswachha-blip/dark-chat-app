---
name: testing-dark-chat
description: How to run and end-to-end test the dark-chat-app (Express + Socket.IO relay in server.js, single-file static client index.html) locally with two browser participants, including how to reach the internal socket from the DevTools console.
---

# Testing dark-chat-app locally

## Bring up the app
```bash
cd <repo> && npm install          # deps: express, socket.io, cors
npm start                         # server.js, PORT env var, default 3000  -> logs "Server running on port 3000"
python3 -m http.server 8080       # serve the repo root; open http://localhost:8080/index.html
```
- The client MUST be served over http, not `file://` (Socket.IO CORS + data URLs).
- `index.html` hardcodes the production backend around line 660:
  `const socket = io("https://dark-chat-backend-2v8y.onrender.com")`.
  For local testing change it to `io("http://localhost:3000")`. This is a **test-only tweak — do not
  commit it**. Make copies (e.g. `debug.html`) instead of editing the original when possible.
- The client loads socket.io, simple-peer and picmo from CDNs, so outbound internet is required;
  if any CDN is blocked the app degrades (picmo failure now alerts "Emoji picker is unavailable").

## Two participants
Open two tabs/windows on `http://localhost:8080/index.html`. The server puts everyone in a single
fixed `chat-room`, so any two tabs are the two participants. Header pill shows `online`, sidebar
shows `Online: 2`.

## Reaching `socket` from the DevTools console (important)
All client JS is wrapped in `(function(){ ... window.addEventListener('DOMContentLoaded', () => { ...`,
so `socket`, `tttBoard`, etc. are **not** global — `socket.emit(...)` in the console throws
`ReferenceError`. To test malformed payloads / validation, make a temporary copy that exposes them:

```bash
python3 - <<'EOF'
lines = open('index.html').read().split('\n')          # after pointing socket at localhost
lines.insert(660, "      window.__socket = socket; window.__ttt = () => ({board: tttBoard, mine: tttMySymbol, turn: tttTurn});")
open('debug.html','w').write('\n'.join(lines))
EOF
```
Then use `window.__socket.emit('send_message', null)` etc. Beware: the DevTools console can mangle
long typed strings (autocomplete) — prefer `window.__socket` over `__socket` and verify the echoed
command in the console before trusting a result.

Other handy temporary copies:
- `dead.html`: socket URL pointed at an unused port (e.g. 3999) → proves the pill shows
  `connection error` rather than staying `connecting...`.
- `nopicmo.html`: picmo `<script src>` pointed at a 404 → proves the emoji-button failure alert.

## UI map (for automation)
- Header status pill: `#status`; online count `#myStatus` (sidebar).
- Composer: `#messageInput`, `#sendBtn`, emoji `#emojiBtn`, snap `#openSnap`.
- Sidebar buttons: Snap, `#attach` (opens hidden `#fileInput`), Call `#startCallBtn`, `⋯ More`
  (`#moreBtn`) → `#openGamesBtn` → games overlay tiles (`.game-tile[data-game=ttt-multi|rps-multi]`).
- Games: `#tttBoard` (9 cells in DOM order = indices 0..8), `#rpsChoices .rps-choice`.
- Whoever clicks the game tile last becomes X (each `tttStart()` broadcasts `ttt_reset`, which flips
  the other player to O). Launch order matters when scripting a game.
- Attachment cap is 8 MB client-side; server `maxHttpBufferSize` is 12 MB.

## Environment limits
- No camera/mic and an http origin, so `getUserMedia` always fails with
  `NotFoundError: Requested device not found`. Real WebRTC call connection cannot be tested here;
  only the error paths (Call/Snap alerts) can.
- Errors are surfaced via `alert()` — dismiss the dialog (click OK) before the next UI action, or
  subsequent clicks are swallowed.
- If Chrome dies, it can be relaunched with:
  `/opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome --remote-debugging-port=29229 --user-data-dir=/home/ubuntu/.config/google-chrome-for-testing <url>`
  (the `browser_console` tool may then be unable to attach; use the in-page DevTools instead, which
  is also better evidence for a recording).

## Known silent-failure gaps (verify if touching these areas)
- A corrupt/unloadable attachment data URL renders as a blank bubble (`appendMessage` has no
  `img.onerror`).
- A payload above `maxHttpBufferSize` closes the socket with no user-facing alert and only a generic
  `transport error` server log.
- Sidebar `Online:` count is not reset on disconnect (stays stale).
- The `typing` / `user_typing` events exist on the server but the client neither emits nor listens.

## Devin Secrets Needed
None — everything runs locally with no credentials.
