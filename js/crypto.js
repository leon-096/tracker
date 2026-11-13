/* crypto.js — all encryption via the browser Web Crypto API.
   - PBKDF2 / SHA-256 / 250,000 iterations / 16-byte salt / 256-bit AES key
   - AES-GCM with a random 12-byte IV per encryption
   - blob shape: { salt, iv, ciphertext } (base64)                            */
window.CryptoUtil = (function () {
  "use strict";

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITERATIONS = 250000;

  function bytesToBase64(bytes) {
    const arr = new Uint8Array(bytes);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  async function deriveKey(password, saltBytes) {
    const material = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      true, // extractable so a soft reload can restore the session key
      ["encrypt", "decrypt"]
    );
  }

  async function encryptJSON(obj, key) {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))
    );
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ct) };
  }

  async function decryptJSON(blob, key) {
    const iv = base64ToBytes(blob.iv);
    const ct = base64ToBytes(blob.ciphertext);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(dec.decode(pt));
  }

  async function exportKey(key) {
    return bytesToBase64(await crypto.subtle.exportKey("raw", key));
  }

  async function importKey(b64) {
    return crypto.subtle.importKey(
      "raw", base64ToBytes(b64), { name: "AES-GCM", length: 256 }, true,
      ["encrypt", "decrypt"]
    );
  }

  function passwordStrength(pw) {
    let score = 0;
    if (pw.length >= 8) score += 30;
    if (pw.length >= 12) score += 15;
    if (pw.length >= 16) score += 15;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 15;
    if (/\d/.test(pw)) score += 10;
    if (/[^A-Za-z0-9]/.test(pw)) score += 15;
    score = Math.min(100, score);
    let label = "weak";
    if (score >= 80) label = "strong";
    else if (score >= 55) label = "good";
    else if (score >= 30) label = "fair";
    return { score, label };
  }

  return {
    ITERATIONS,
    bytesToBase64,
    base64ToBytes,
    randomBytes,
    deriveKey,
    encryptJSON,
    decryptJSON,
    exportKey,
    importKey,
    passwordStrength,
  };
})();
