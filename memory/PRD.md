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
- 1-to-1 E2E encrypted chat (send/receive, 3s polling, empty state, call modal stub).
- Worries space: E2E-encrypted notes, add + resolve.
- Shared Calendar: month grid, per-day events, add (shared/personal) + delete.
- Profile/"Us": pair card, privacy/security info, disconnect, sign out.
- Branding: Twogether name, logo icon/splash, warm palette.
- Tested: 20/20 backend pytest pass; full frontend E2E flow verified.

## Backlog / Remaining
- P0: Real voice/video calling (WebRTC) — needs device build + signaling server.
- P0: Screenshot/save blocking (platform-native, device build only).
- P1: Photo/video sharing with per-item save & view-once enforcement (Object Storage).
- P1: Native phone-calendar sync (read/write) for the shared calendar.
- P1: Real-time messaging (WebSockets) instead of 3s polling; typing/read receipts.
- P2: Push notifications (on user request; needs device build).
- P2: Key-verification/fingerprint UX for E2E identity assurance; multi-device key sync.

## Next Tasks
- Add photo/video sharing with view-once controls (Emergent Object Storage).
- Upgrade chat to WebSockets for instant delivery.
- Wire native calendar sync.
