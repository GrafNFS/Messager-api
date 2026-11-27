import { getDB, toBase64, fromBase64 } from './db';
import { getOrCreateDeviceId } from '../utils/deviceId';

const DB_STORE = 'crypto_keys';

export interface KeyBundle {
  deviceId: string;
  identityKey: string;
  publicKey: string;
  registrationId: number;
}

export class WebCryptoManager {
  private myId: string;
  private deviceId: string;
  private privateKey: CryptoKey | null = null;
  private publicKey: CryptoKey | null = null;

  constructor(myId: string) {
    this.myId = myId;
    this.deviceId = getOrCreateDeviceId();
  }

  async initialize(): Promise<KeyBundle> {
    const db = await getDB();
    const existing = await db.get(DB_STORE, `${this.myId}:${this.deviceId}`);

    if (existing) {
      this.privateKey = await crypto.subtle.importKey(
        'jwk',
        existing.privateKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits', 'deriveKey']
      );
      this.publicKey = await crypto.subtle.importKey(
        'jwk',
        existing.publicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      console.log('✅ Loaded existing keys from IndexedDB');
      return existing.bundle;
    }

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );

    this.privateKey = keyPair.privateKey;
    this.publicKey = keyPair.publicKey;

    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKeyB64 = toBase64(new Uint8Array(publicKeyRaw));

    const registrationId = Math.floor(Math.random() * 16383) + 1;

    const bundle: KeyBundle = {
      deviceId: this.deviceId,
      identityKey: publicKeyB64,
      publicKey: publicKeyB64,
      registrationId,
    };

    await db.put(DB_STORE, {
      key: `${this.myId}:${this.deviceId}`,
      privateKeyJwk,
      publicKeyJwk,
      bundle,
    });

    console.log('✅ Generated new keys and saved to IndexedDB');
    return bundle;
  }

  async encrypt(
    recipientPublicKeyB64: string,
    plaintext: string
  ): Promise<{ iv: string; ciphertext: string }> {
    if (!this.privateKey) throw new Error('Private key not initialized');

    const recipientKeyRaw = fromBase64(recipientPublicKeyB64);
    const recipientKey = await crypto.subtle.importKey(
      'raw',
      recipientKeyRaw.buffer as ArrayBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: recipientKey },
      this.privateKey,
      256
    );

    const aesKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encoder.encode(plaintext)
    );

    return {
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
  }

  async decrypt(
    senderPublicKeyB64: string,
    ivB64: string,
    ciphertextB64: string
  ): Promise<string> {
    if (!this.privateKey) throw new Error('Private key not initialized');

    const senderKeyRaw = fromBase64(senderPublicKeyB64);
    const senderKey = await crypto.subtle.importKey(
      'raw',
      senderKeyRaw.buffer as ArrayBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: senderKey },
      this.privateKey,
      256
    );

    const aesKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const iv = fromBase64(ivB64);
    const ciphertext = fromBase64(ciphertextB64);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      aesKey,
      ciphertext.buffer as ArrayBuffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  async getPublicKeyB64(): Promise<string> {
    if (!this.publicKey) throw new Error('Public key not initialized');
    const raw = await crypto.subtle.exportKey('raw', this.publicKey);
    return toBase64(new Uint8Array(raw));
  }

  randomUUID(): string {
    return crypto.randomUUID();
  }
}