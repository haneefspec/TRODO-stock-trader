// lib/crypto.js
// All exchange API secrets are encrypted with a key derived from the user's
// local vault passphrase (PBKDF2 -> AES-GCM). The passphrase itself is never
// stored anywhere. If it's lost, saved keys must be re-entered — that's the
// point: there is no recovery backdoor that could also be a breach point.

const PBKDF2_ITERATIONS = 250000;
const SALT_STORAGE_KEY = "trodo_vault_salt";

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function getSalt() {
  const stored = await chrome.storage.local.get(SALT_STORAGE_KEY);
  if (stored[SALT_STORAGE_KEY]) {
    return new Uint8Array(b64ToBuf(stored[SALT_STORAGE_KEY]));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [SALT_STORAGE_KEY]: bufToB64(salt) });
  return salt;
}

async function deriveKey(passphrase) {
  const salt = await getSalt();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(passphrase, plaintext) {
  const key = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: bufToB64(iv), data: bufToB64(ciphertext) };
}

export async function decryptSecret(passphrase, { iv, data }) {
  const key = await deriveKey(passphrase);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(iv)) },
    key,
    b64ToBuf(data)
  );
  return new TextDecoder().decode(plainBuf);
}

// Cheap check so the UI can tell "wrong passphrase" apart from "no vault yet"
// without ever storing the passphrase itself.
export async function makeVerifier(passphrase) {
  return encryptSecret(passphrase, "trodo-vault-ok");
}

export async function checkVerifier(passphrase, verifier) {
  try {
    const result = await decryptSecret(passphrase, verifier);
    return result === "trodo-vault-ok";
  } catch {
    return false;
  }
}
