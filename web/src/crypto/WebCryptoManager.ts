import { getDB, toBase64, fromBase64 } from './db';
import { getOrCreateDeviceId } from '../utils/deviceId';
import * as libsignal from '@signalapp/libsignal-client';

const DB_STORE = 'signal_protocol';

export interface DeviceKeysBundle {
  deviceId: string;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySig: string;
  registrationId: number;
  oneTimeKeys: Array<{ keyId: number; publicKey: string }>;
}

export class WebCryptoManager {
  private myId: string;
  private deviceId: string;
  private identityKeyPair: libsignal.IdentityKeyPair | null = null;
  private registrationId: number = 0;

  private sessionStore!: libsignal.SessionStore;
  private identityStore!: libsignal.IdentityKeyStore;
  private preKeyStore!: libsignal.PreKeyStore;
  private signedPreKeyStore!: libsignal.SignedPreKeyStore;

  constructor(myId: string) {
    this.myId = myId;
    this.deviceId = getOrCreateDeviceId();
  }

  async initialize(): Promise<DeviceKeysBundle> {
    const db = await getDB();
    const existing = await db.get(DB_STORE, `${this.myId}:${this.deviceId}`);

    if (existing) {
      this.identityKeyPair = libsignal.IdentityKeyPair.deserialize(
        new Uint8Array(fromBase64(existing.identityKeyPair))
      );
      this.registrationId = existing.registrationId;
      this.setupStores(existing.sessions || {}, existing.preKeys || {}, existing.signedPreKeys || {});
      console.log('✅ Loaded Signal keys from IndexedDB');
      return existing.bundle;
    }

    // Генерация новых ключей Signal Protocol
    this.identityKeyPair = libsignal.IdentityKeyPair.generate();
    this.registrationId = Math.floor(Math.random() * 16383) + 1;

    // Signed PreKey
    const signedPreKeyId = 1;
    const signedPreKeyPair = libsignal.PrivateKey.generate();
    const signedPreKeySig = this.identityKeyPair.privateKey.sign(
      signedPreKeyPair.getPublicKey().serialize()
    );

    // One-Time PreKeys (30 штук)
    const oneTimeKeys: Array<{ keyId: number; publicKey: string }> = [];
    const preKeys: Record<number, string> = {};
    for (let i = 1; i <= 30; i++) {
      const priv = libsignal.PrivateKey.generate();
      preKeys[i] = toBase64(priv.serialize());
      oneTimeKeys.push({
        keyId: i,
        publicKey: toBase64(priv.getPublicKey().serialize()),
      });
    }

    const bundle: DeviceKeysBundle = {
      deviceId: this.deviceId,
      identityKey: toBase64(this.identityKeyPair.publicKey.serialize()),
      signedPreKeyId,
      signedPreKeyPublic: toBase64(signedPreKeyPair.getPublicKey().serialize()),
      signedPreKeySig: toBase64(signedPreKeySig),
      registrationId: this.registrationId,
      oneTimeKeys,
    };

    await db.put(DB_STORE, {
      key: `${this.myId}:${this.deviceId}`,
      identityKeyPair: toBase64(this.identityKeyPair.serialize()),
      registrationId: this.registrationId,
      sessions: {},
      preKeys,
      signedPreKeys: { [signedPreKeyId]: toBase64(signedPreKeyPair.serialize()) },
      bundle,
    });

    this.setupStores({}, preKeys, { [signedPreKeyId]: toBase64(signedPreKeyPair.serialize()) });
    console.log('✅ Generated Signal keys');
    return bundle;
  }

  private setupStores(
    sessionsData: Record<string, string>,
    preKeysData: Record<number, string>,
    signedPreKeysData: Record<number, string>
  ) {
    const self = this;

    // SessionStore
    this.sessionStore = new (class extends libsignal.SessionStore {
      private sessions: Map<string, libsignal.SessionRecord> = new Map();
      constructor() {
        super();
        for (const [k, v] of Object.entries(sessionsData)) {
          this.sessions.set(k, libsignal.SessionRecord.deserialize(new Uint8Array(fromBase64(v))));
        }
      }
      async saveSession(name: libsignal.ProtocolAddress, record: libsignal.SessionRecord): Promise<void> {
        const key = `${name.name()}.${name.deviceId()}`;
        this.sessions.set(key, record);
        const db = await getDB();
        const existing = await db.get(DB_STORE, `${self.myId}:${self.deviceId}`);
        await db.put(DB_STORE, { ...existing, sessions: { ...existing.sessions, [key]: toBase64(record.serialize()) } });
      }
      async getSession(name: libsignal.ProtocolAddress): Promise<libsignal.SessionRecord | null> {
        return this.sessions.get(`${name.name()}.${name.deviceId()}`) || null;
      }
      async getExistingSessions(addresses: libsignal.ProtocolAddress[]): Promise<libsignal.SessionRecord[]> {
        return addresses.map(a => this.sessions.get(`${a.name()}.${a.deviceId()}`)).filter(Boolean) as libsignal.SessionRecord[];
      }
    })();

    // IdentityKeyStore
    this.identityStore = new (class extends libsignal.IdentityKeyStore {
      private identities: Map<string, libsignal.PublicKey> = new Map();
      constructor(private identityKeyPair: libsignal.IdentityKeyPair, private registrationId: number) {
        super();
      }
      async getIdentityKey(): Promise<libsignal.PrivateKey> { return this.identityKeyPair.privateKey; }
      async getLocalRegistrationId(): Promise<number> { return this.registrationId; }
      async saveIdentity(name: libsignal.ProtocolAddress, key: libsignal.PublicKey): Promise<libsignal.IdentityChange> {
        const k = `${name.name()}.${name.deviceId()}`;
        const existing = this.identities.get(k);
        this.identities.set(k, key);
        const db = await getDB();
        const existing2 = await db.get(DB_STORE, `${self.myId}:${self.deviceId}`);
        await db.put(DB_STORE, { ...existing2, identities: { ...existing2.identities, [k]: toBase64(key.serialize()) } });
        return existing ? libsignal.IdentityChange.NewOrUnchanged : libsignal.IdentityChange.ReplacedExisting;
      }
      async isTrustedIdentity(_name: libsignal.ProtocolAddress, _key: libsignal.PublicKey, _direction: libsignal.Direction): Promise<boolean> {
        return true;
      }
      async getIdentity(name: libsignal.ProtocolAddress): Promise<libsignal.PublicKey | null> {
        return this.identities.get(`${name.name()}.${name.deviceId()}`) || null;
      }
    })(this.identityKeyPair!, this.registrationId);

    // PreKeyStore
    this.preKeyStore = new (class extends libsignal.PreKeyStore {
      private keys: Map<number, libsignal.PreKeyRecord> = new Map();
      constructor(data: Record<number, string>) {
        super();
        for (const [id, b64] of Object.entries(data)) {
          this.keys.set(Number(id), libsignal.PreKeyRecord.deserialize(new Uint8Array(fromBase64(b64))));
        }
      }
      async savePreKey(id: number, record: libsignal.PreKeyRecord): Promise<void> { this.keys.set(id, record); }
      async getPreKey(id: number): Promise<libsignal.PreKeyRecord> { return this.keys.get(id)!; }
      async removePreKey(id: number): Promise<void> { this.keys.delete(id); }
    })(preKeysData);

    // SignedPreKeyStore
    this.signedPreKeyStore = new (class extends libsignal.SignedPreKeyStore {
      private keys: Map<number, libsignal.SignedPreKeyRecord> = new Map();
      constructor(data: Record<number, string>) {
        super();
        for (const [id, b64] of Object.entries(data)) {
          this.keys.set(Number(id), libsignal.SignedPreKeyRecord.deserialize(new Uint8Array(fromBase64(b64))));
        }
      }
      async saveSignedPreKey(id: number, record: libsignal.SignedPreKeyRecord): Promise<void> { this.keys.set(id, record); }
      async getSignedPreKey(id: number): Promise<libsignal.SignedPreKeyRecord> { return this.keys.get(id)!; }
    })(signedPreKeysData);
  }

  /** Шифрование для конкретного устройства получателя */
  async encrypt(
    recipientUserId: string,
    recipientDeviceId: number,
    recipientBundle: DeviceKeysBundle,
    plaintext: string
  ): Promise<{ type: number; data: string }> {
    if (!this.sessionStore || !this.identityKeyPair) throw new Error('Not initialized');

    const address = libsignal.ProtocolAddress.new(recipientUserId, recipientDeviceId);
    const localAddress = libsignal.ProtocolAddress.new(this.myId, this.deviceIdToInt(this.deviceId));

    // Инициализация сессии, если нет
    const existing = await this.sessionStore.getSession(address);
    if (!existing) {
      const preKeyBundle = libsignal.PreKeyBundle.new(
        recipientBundle.registrationId,
        recipientDeviceId,
        recipientBundle.oneTimeKeys[0]?.keyId ?? null,
        recipientBundle.oneTimeKeys[0]
          ? libsignal.PublicKey.deserialize(new Uint8Array(fromBase64(recipientBundle.oneTimeKeys[0].publicKey)))
          : null,
        recipientBundle.signedPreKeyId,
        libsignal.PublicKey.deserialize(new Uint8Array(fromBase64(recipientBundle.signedPreKeyPublic))),
        new Uint8Array(fromBase64(recipientBundle.signedPreKeySig)),
        libsignal.PublicKey.deserialize(new Uint8Array(fromBase64(recipientBundle.identityKey))),
        null, // kyber_prekey_id
        null as any, // kyber_prekey (не используем)
        new Uint8Array(0) // kyber_prekey_signature (пустая)
      );

      await libsignal.processPreKeyBundle(
        preKeyBundle,
        address,
        localAddress,
        this.sessionStore,
        this.identityStore
      );
    }

    const ciphertext = await libsignal.signalEncrypt(
      new TextEncoder().encode(plaintext),
      address,
      localAddress,
      this.sessionStore,
      this.identityStore
    );

    return {
      type: ciphertext.type(),
      data: toBase64(ciphertext.serialize()),
    };
  }

  /** Дешифрование */
  async decrypt(
    senderUserId: string,
    senderDeviceId: number,
    type: number,
    data: string
  ): Promise<string> {
    if (!this.sessionStore) throw new Error('Not initialized');

    const address = libsignal.ProtocolAddress.new(senderUserId, senderDeviceId);
    const localAddress = libsignal.ProtocolAddress.new(this.myId, this.deviceIdToInt(this.deviceId));

    let plaintext: Uint8Array;
    if (type === 3) { // PreKeyMessage
      const msg = libsignal.PreKeySignalMessage.deserialize(new Uint8Array(fromBase64(data)));
      plaintext = await libsignal.signalDecryptPreKey(
        msg, address, localAddress,
        this.sessionStore, this.identityStore, this.preKeyStore, this.signedPreKeyStore,
        undefined as any // KyberPreKeyStore не используем
      );
    } else {
      const msg = libsignal.SignalMessage.deserialize(new Uint8Array(fromBase64(data)));
      plaintext = await libsignal.signalDecrypt(
        msg, address, localAddress,
        this.sessionStore, this.identityStore
      );
    }

    return new TextDecoder().decode(plaintext);
  }

  deviceIdToInt(deviceId: string): number {
    const n = parseInt(deviceId, 10);
    if (!isNaN(n)) return n;
    let hash = 0;
    for (let i = 0; i < deviceId.length; i++) {
      hash = ((hash << 5) - hash + deviceId.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 16383) + 1;
  }

  getDeviceId(): string {
    return this.deviceId;
  }
}
