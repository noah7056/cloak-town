# 🧥 Cloak Town — 2D hangout with friends (VRChat-lite, Among-Us vibes)

Walk around tiny worlds with friends, proximity voice-chat, kick a ball, collect coins.

## Quick start

One link does everything now — the server serves the built client.

```powershell
# one-time setup
cd client; npm install; npm run build; cd ../server; npm install

# run (single terminal, single link)
cd server; npm run dev
# → open http://localhost:3001 — join public, create private, share the code
```

Dev mode (2 terminals, hot reload) still works:
```powershell
cd server; npm run dev     # game server :3001
cd client; npm run dev     # web client :5173 (auto-connects to :3001)
```

To share with a friend in another country, host the server somewhere public
(Render / Fly / Railway / any VPS) and send them its URL — no env config needed
since the page connects back to the same origin. `VITE_SERVER_URL` still
overrides this for split hosting.

Open the client URL in 2 browser windows, pick different names/colors, and walk with **WASD / arrows**.

## Features (MVP)
- 🎮 Top-down 2D movement, Among-Us-like bean characters, smooth multiplayer interpolation
- 🏠 Rooms: public plaza + private rooms with invite codes (`ABC-123`), copy-code button
- 🗺️ 3 starter maps: Sunny Plaza, Cozy Beach, Arcade Loft (world is picked in the lobby and fixed per room — see `client/src/game/maps.ts`)
- 💬 Room chat + overhead speech bubbles, join/leave notifications, collapsible chat panel with unread badge
- 🎙️ Proximity voice (WebRTC mesh, volume fades with distance, mic OFF by default — click to join)
- ⚽ Shared football with authoritative physics (kicks blend your velocity, bounces off walls, rolls to a stop) + a pitch in Sunny Plaza
- 📺 Cozy TV in the arcade loft: paste a link, watch together in sync
- 🐍 Snake cabinet in the arcade loft: E locks you in, 1 token per run (vendor sells 1 coin = 5), fill the board wins +5 coins, spectators mirror live
- 🏓 Pong cabinet in the arcade loft: E locks you in (2 max), 1 token each, both Ready starts first-to-11 with W/S or arrows, winner +1 coin, spectators mirror live
- 🏒 Air hockey table in the arcade loft: E locks you in at your end (P1 west, P2 east), 1 token each, both Ready starts first-to-7 with mouse-driven mallets (release to fling), winner +1 coin, the table itself shows the live game to the room
- 🏆 Arcade records (snake PB, pong wins) persist per account across rooms and devices (Supabase `arcade_pb` — run the new block in `supabase/schema.sql`)
- 😀 8 vector emotes (E opens the picker, 1–8 fires) with hop/dance avatar actions
- ⚙️ Options menu (ESC): world info, invite code, mic select, toggle/push-to-talk + keybind, leave

## Project layout
```
server/index.js      — authoritative rooms, 15Hz state broadcast, voice signaling relay
client/src/
  App.tsx            — lobby (name/color/world) + game HUD (players/chat/voice)
  game/maps.ts       — map defs + collision (add your own here)
  game/engine.ts     — canvas renderer + input + camera + interpolation
  voice/useVoice.ts  — WebRTC mesh + proximity gain + speaking indicator
```

## Next ideas
- Sitting / dancing emotes (E key), player collision + tag mode
- Tic-tac-toe / trivia board as first real minigame
- Persistent accounts + custom avatar accessories
- Deploy: server on Render/Fly, client on Vercel/Cloudflare Pages (`VITE_SERVER_URL` env)
