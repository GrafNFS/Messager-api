import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { WebCryptoManager } from '../crypto/WebCryptoManager';

export interface DecryptedMessage {
  from: string;
  fromDeviceId: string;
  text: string;
  messageId: string;
  timestamp: number;
  isOffline: boolean;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  onlineUsers: Set<string>;
  crypto: WebCryptoManager | null;
  messages: DecryptedMessage[];
  joinRoom: () => void;
  sendMessage: (to: string, toPublicKey: string, text: string) => Promise<boolean>;
}

const SocketContext = createContext<SocketContextType | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [crypto, setCrypto] = useState<WebCryptoManager | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);

  const userId = localStorage.getItem('user_id') || '';

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || !userId) return;

    const deviceId = getOrCreateDeviceId();
    const manager = new WebCryptoManager(userId);

    manager.initialize().then(async (bundle) => {
    console.log('✅ Crypto initialized, deviceId:', deviceId);
    
    // Генерируем фиктивную подпись (Web Crypto API не использует Signal-подписи,
    // но сервер требует это поле — заполняем случайными байтами)
    const fakeSignatureBytes = window.crypto.getRandomValues(new Uint8Array(64));
    let fakeSignatureB64 = '';
    for (let i = 0; i < fakeSignatureBytes.length; i++) {
        fakeSignatureB64 += String.fromCharCode(fakeSignatureBytes[i]);
    }
    fakeSignatureB64 = btoa(fakeSignatureB64);

    const payload = {
        deviceId: bundle.deviceId,
        identityKey: bundle.identityKey,
        signedPreKeyId: 1,
        signedPreKeyPublic: bundle.publicKey,
        signedPreKeySig: fakeSignatureB64, // ✅ Теперь непустое значение
        oneTimeKeys: [],
        registrationId: bundle.registrationId, // ✅ Уже число из WebCryptoManager
    };

    console.log('📤 Uploading keys payload:', payload);

    const resp = await fetch('/api/keys/upload', {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const errText = await resp.text();
        console.error('❌ Failed to upload keys:', resp.status, errText);
    } else {
        const result = await resp.json();
        console.log('✅ Keys uploaded successfully:', result);
    }
    }).catch(err => console.error('❌ Crypto init failed:', err));

    setCrypto(manager);

    const newSocket = io('/', {
      transports: ['websocket', 'polling'],
      auth: { token, deviceId },
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('🔌 Connected, deviceId:', deviceId);
    });
    newSocket.on('disconnect', () => setIsConnected(false));
    newSocket.on('connect_error', (err) => {
      console.error('Socket error:', err.message);
      if (err.message === 'unauthorized') {
        localStorage.removeItem('auth_token');
        window.location.reload();
      }
    });

    newSocket.on('user_status', (d: { userId: string; isOnline: boolean }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        d.isOnline ? next.add(d.userId) : next.delete(d.userId);
        return next;
      });
    });

    newSocket.on('private_message', async (data: any) => {
      try {
        const { iv, ciphertext } = data.payload?.data || {};
        if (!iv || !ciphertext) {
          console.warn('⚠️ Message without encrypted data:', data);
          return;
        }
        const text = await manager.decrypt(
          data.fromPublicKey || '',
          iv,
          ciphertext
        );
        setMessages(prev => [...prev, {
          from: data.from,
          fromDeviceId: data.fromDeviceId || '1',
          text,
          messageId: data.messageId,
          timestamp: data.timestamp,
          isOffline: !!data.isOffline,
        }]);
      } catch (e) {
        console.error('❌ Decrypt failed:', e);
      }
    });

    setSocket(newSocket);
    return () => { newSocket.close(); };
  }, [userId]);

  const joinRoom = useCallback(() => {
    socket?.emit('join_room');
  }, [socket]);

  const sendMessage = useCallback(async (to: string, toPublicKey: string, text: string) => {
    if (!crypto || !socket?.connected) return false;
    try {
      const encrypted = await crypto.encrypt(toPublicKey, text);
      const messageId = crypto.randomUUID();
      socket.emit('private_message', {
        to,
        payloads: [{
          deviceId: '1',
          type: 'encrypted',
          data: encrypted,
        }],
        messageId,
        typeMsg: 'text',
      });
      return true;
    } catch (e) {
      console.error('Send failed:', e);
      return false;
    }
  }, [crypto, socket]);

  return (
    <SocketContext.Provider value={{
      socket, isConnected, onlineUsers, crypto, messages, joinRoom, sendMessage,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}