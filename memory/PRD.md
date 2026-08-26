# Twogether — Product Requirements & Progress

## Original Problem Statement
Build a mobile app ("Twogether" / "2Gether") — a private, two-person, end-to-end
encrypted app for couples (especially long-distance). User provided a spec PDF and a
GitHub ZIP (ClanChatApp — a React web/Capacitor social app on Supabase). The ZIP is a
web app and is NOT directly reusable on this native Expo platform, so Twogether was
rebuilt fresh for React Native / Expo + FastAPI + MongoDB, following the spec concepts.

## User Choices
- MVP first: Pairing (connect exactly 2 people via invite code) + 1-to-1 chat.
- Calling & screenshot-blocking: build UI now, wire real calling after a device build.
- End-to-end encryption: HARD requirement even for MVP.
- Sign-in: Email + password.
- Style: Warm romantic palette; build toward the full spec over time.

## Architecture
- Frontend: Expo Router (React Native), DM Sans (expo-font), warm palette design tokens
  in src/theme/theme.ts, bottom tabs (Chat / Calendar / Worries / Us), expo-haptics,
  expo-blur glass tab bar (iOS).
- E2E crypto: tweetnacl (NaCl box, Curve25519). Device secret key in SecureStore; only
  public key uploaded. Shared-DH key => both partners encrypt/decrypt with
  (partnerPublicKey, mySecretKey). See src/lib/crypto.ts.
- Backend: FastAPI + MongoDB (motor). JWT auth (bcrypt hash), pairing, messages,
  worries, events. Stores ciphertext only for messages/worries; never plaintext,
  never exposes password_hash or _id.

## User Personas
- Committed couples, especially long-distance, wanting a private relationship-only space.

## Core Requirements (static)
- Exactly two users per pairing; one active pairing per user.
- E2E encryption for messages (and worries).
- Shared calendar, dedicated Worries space, per-media save/view-once controls,
  voice/video calling, screenshot/save blocking.

## Implemented (2026-06-25)
- Email/password auth (register/login/JWT) + device keypair generation & sync.
- Invite-code pairing: create code, redeem code, active-pair enforcement, unpair.
- 1-to-1 E2E encrypted chat (send/receive, empty state, call modal stub).
- Worries space: E2E-encrypted notes, add + resolve.
- Shared Calendar: month grid, per-day events, add (shared/personal) + delete.
- Profile/"Us": pair card, privacy/security info, disconnect, sign out.
- Branding: Twogether name, logo icon/splash, warm palette.

## Implemented — Round 2 (2026-06-25)
- Instant Delivery: WebSocket (/api/ws) real-time messages + typing indicator + read receipts (fallback 10s poll).
- Photo/Video sharing: FULL E2E encrypted media (NaCl box on bytes) stored as ciphertext in Emergent Object Storage; per-item "view once" (410 after viewed) and "allow save" toggles; in-app image viewer + expo-video player.
- Real Calling: full call-screen UI scaffold (/call) with mute/speaker/video/end controls + device-build banner (LiveKit engine to be wired later).
- Calendar Sync: expo-calendar write to phone ("Also add to my phone calendar" + per-event sync) with permission handling.
- Daily Check-in (Mood tab): mood emoji + optional E2E-encrypted note (one upsert per day); partner emoji reactions.
- Tested: 36/36 backend pytest pass; all 5 frontend features verified by testing agent.

## Implemented — Round 3 (2026-06-25)
- Explicit save permission on send: sender chooses "Allow saving" yes/no per media.
- Save-to-gallery: receiver gets a Save button (expo-media-library) ONLY when allowed; disabled/hidden otherwise.
- Shared Gallery screen (pushed from chat header): grid of all previously shared media; view-once items shown as locked tiles; fullscreen viewer with Save.
- Screenshot protection (expo-screen-capture): blocks on Android (FLAG_SECURE) across media viewer, gallery, and Worries; on iOS detects screenshots and warns the partner via an encrypted 'system' chat message (centered warning pill); content blurred/hidden when app backgrounded (PrivacyGuard + AppState). Web = graceful no-op.
- Backend GET /api/gallery (media-only, excludes system/text messages).
- Tested: 48/48 backend pytest pass; new gallery/save/screenshot flows verified (device-only paths confirmed graceful on web).

## Implemented — Round 4 (2026-06-25)
- Auto-expire media: sender picks Off / 1h / 24h / 7d in the send modal; media vanishes for BOTH after the timer.
  - Backend: expire_seconds on message → expires_at stored on message + media; GET /api/media/{id} returns 410 after expiry (marks consumed); GET /api/gallery filters out expired items.
  - Frontend: expiry chips in media modal; MediaBubble shows "Vanishes in Xd/Xh/Xm" countdown and an "expired" placeholder once elapsed.
- LiveKit Cloud credentials stored in backend/.env (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET) for wiring real calling next (not yet wired).
- Tested: backend auto-expire round-trip verified (download 200 → 410 after expiry; gallery drops expired).

## Implemented — Round 5 (2026-06-25)
- Expiry-after-view: media auto-expire timer now starts when the RECIPIENT first opens it (not at send). expire_seconds stored on send; expires_at set on first non-owner /api/media GET; WS 'expiry_started' broadcast updates both clients' countdowns live. MediaBubble shows "Vanishes {1h/24h/7d} after opening" pre-open, then live countdown, then expired placeholder.
- LiveKit calling (real E2E voice/video):
  - Backend POST /api/livekit/token mints a room token (room = pair_<pairId>) via livekit-api using LIVEKIT_URL/KEY/SECRET in .env; both partners join the same room; 400 if unpaired.
  - Frontend src/components/LiveCall.tsx (@livekit/react-native) joins room, publishes audio/video, mute/camera/end, remote + local PIP video; loaded ONLY on a device build (guarded via expo-constants executionEnvironment + Platform); web stub keeps the web/Expo Go bundle clean; app/call.tsx renders LiveCall on device builds, scaffold+banner otherwise.
  - Permissions added (camera/mic on iOS+Android); config plugins @livekit/react-native-expo-plugin + @config-plugins/react-native-webrtc.
- Tested: 65/65 backend pytest pass (expiry-after-view state machine + livekit token verified). Calling UI is device-build only.

## Implemented — Round 6 (2026-06-25)
- Incoming Call Ring: global CallProvider (mounted in tabs layout) opens its own WebSocket so an incoming call rings from ANY tab. Caller taps voice/video → WS 'call_invite' (with caller name + mode) → partner sees a full-screen ringing screen (Accept/Decline, vibration + haptics). Accept → both join the LiveKit room; Decline → caller gets a "Call declined" toast. Backend relays call_invite/cancel/accept/decline over /api/ws.
- Verified over live WebSocket (invite + decline round-trip).

## Deployment / builds (platform)
- Push to GitHub: use the "Save to GitHub" button (paid plans). Android APK/AAB + iOS builds: Publish (top-right) → Deploy → Publish to Play Store / App Store. No EAS CLI or external tooling — Emergent manages Expo/EAS. eas.json is Emergent-managed and untouched.

## Fixes — Round 7 (2026-06-26, device-build bugs)
- Layout/scaling: bottom tab bar was `position:absolute` and overlapped screen content (chat composer hidden → "can't use chat"). Made the tab bar non-absolute (reserves layout space); removed the +64/+76 offsets that assumed an overlay bar. Chat composer paddingBottom → S.sm; calendar/worries FABs → bottom S.xl.
- Media on device: replaced RN `fetch().arrayBuffer()` (unreliable on native) with `expo-file-system.downloadAsync` + base64 read in fetchCipherBytes(); fixes photos/gallery not loading on the installed APK (web still uses fetch/arrayBuffer).
- Video call: show local camera FULL-SCREEN while waiting for partner, switch remote to full-screen + local PIP once partner joins (useTracks onlySubscribed:false so local track is included).
- NOTE: these are native-build behaviors — user must regenerate the APK to verify.
- Push notifications: NOT yet implemented — requires Emergent push integration + google-services.json + a device build (next task).

## Backlog / Remaining
- P0: Wire LiveKit for real E2E voice/video calling (device build + signaling).
- P0: Screenshot/save blocking (platform-native, device build only).
- P1: Two-way calendar sync (import phone events into shared calendar).
- P1: Multi-device E2E key sync + key-verification/fingerprint UX.
- P2: Push notifications (on user request; needs device build).
- P2: Media thumbnails/compression for large videos; download-to-gallery when allow_save is on.

## Next Tasks
- Add photo/video sharing with view-once controls (Emergent Object Storage).
- Upgrade chat to WebSockets for instant delivery.
- Wire native calendar sync.
