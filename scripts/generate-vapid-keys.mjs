#!/usr/bin/env node
/* ==========================================
   GENERATE A VAPID KEYPAIR FOR WEB PUSH

   Run this LOCALLY, on your own machine:

       node scripts/generate-vapid-keys.mjs

   It prints a fresh public/private keypair to THIS terminal only --
   nothing is sent anywhere, no network access, no dependencies
   beyond Node's own built-in crypto module. Copy the two values
   directly into Supabase (Project Settings -> Edge Functions ->
   Secrets) as WEB_PUSH_VAPID_PUBLIC_KEY and
   WEB_PUSH_VAPID_PRIVATE_KEY. Do not paste them into a chat, an
   issue, a commit, or anywhere else -- the private key must never
   leave your machine except by going straight into Supabase's
   secrets UI.

   Requires Node 16 or newer (uses the built-in Web Crypto API via
   node:crypto's `webcrypto`, and Buffer's "base64url" encoding).
   ========================================== */

import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;

function toBase64Url(bytes) {
    return Buffer.from(bytes).toString("base64url");
}

const keyPair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
);

const publicKeyRaw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
const privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);

// A JWK's "d" field is already unpadded base64url per RFC 7518 -- the
// exact format Web Push VAPID keys use, so no re-encoding is needed.
const publicKey = toBase64Url(publicKeyRaw);
const privateKey = privateKeyJwk.d;

console.log("");
console.log("Fresh VAPID keypair generated. Copy each value directly into");
console.log("Supabase Edge Function Secrets -- never into a chat, file, or commit.");
console.log("");
console.log("WEB_PUSH_VAPID_PUBLIC_KEY=" + publicKey);
console.log("WEB_PUSH_VAPID_PRIVATE_KEY=" + privateKey);
console.log("");
console.log("Also set WEB_PUSH_VAPID_SUBJECT to a contact URI, e.g.:");
console.log("WEB_PUSH_VAPID_SUBJECT=mailto:jessica.holsopple3@gmail.com");
console.log("");
