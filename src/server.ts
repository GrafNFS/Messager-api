import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from './middleware/auth';
import { verifyToken } from './utils/jwt';

import { registerDevice, unregisterDevice, sendSilentMessagePush } from './controllers/device.controller';
import { register, login } from './controllers/auth.controller';
import { uploadKeys, getKeysBundle, getRemainingPreKeys, uploadOneTimeKeys } from './controllers/keys.controller';
import {
  getMyContacts, searchUsers, addContact, getMyProfile, updateMyProfile,
  sendFriendRequest, getPendingRequests, respondToFriendRequest, getPendingCountRequests
} from './controllers/user.controller';
import mediaRoutes from './routes/mediaRoutes';

const prisma = new PrismaClient();

// === СОСТОЯНИЕ СОКЕТОВ (в памяти — только маппинги, сообщения теперь в БД) ===
// userId -> Set<socketId>: поддержка нескольких устройств одного пользователя
const userSockets = new Map<string, Set<string>>();
const socketUsers = new Map<string, string>();

const readReceipts = new Map<string, { readBy: string[]; timestamp: number }>();

const getChatKey = (id1: string, id2: string): string => [id1, id2].sort().join(':');

const addSocket = (userId: string, socketId: string) => {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId)!.add(socketId);
  socketUsers.set(socketId, userId);
};

// Возвращает userId, если у него больше не осталось активных сокетов
const removeSocket = (socketId: string): string | null => {
  const userId = socketUsers.get(socketId);
  if (!userId) return null;
  socketUsers.delete(socketId);
  const set = userSockets.get(userId);
  if (set) {
    set.delete(socketId);
    if (set.size === 0) {
      userSockets.delete(userId);
      return userId; // последний сокет отвалился
    }
  }
  return null;
};

const emitToUser = (io: Server, userId: string, event: string, data: any) => {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit(event, data);
};

// Простой in-memory rate limiter для auth-эндпоинтов
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit = 10, windowMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const rec = authAttempts.get(key);
  if (!rec || rec.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

export const startServer = (port: number) => {
  const app = express();
  const server = http.createServer(app);

  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const corsOptions = allowed.length === 1 && allowed[0] === '*' ? {} : { origin: allowed };

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' })); // 50mb для JSON не нужно, медиа идёт через multipart

  // === API ROUTES ===
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/api/register', (req, res, next) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`reg:${ip}`)) return res.status(429).json({ error: 'Too many attempts' });
    next();
  }, register);

  app.post('/api/login', (req, res, next) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`login:${ip}`)) return res.status(429).json({ error: 'Too many attempts' });
    next();
  }, login);

  // Всё ниже — только с валидным JWT. userId больше НЕ принимаем от клиента.
  app.get('/api/users/search', authenticate, searchUsers);
  app.get('/api/myprofile', authenticate, getMyProfile);
  app.put('/api/myprofile', authenticate, updateMyProfile);

  app.post('/api/contacts', authenticate, addContact);
  app.get('/api/contacts', authenticate, getMyContacts);

  app.post('/api/friend-requests', authenticate, sendFriendRequest);
  app.get('/api/friend-requests/pending', authenticate, getPendingRequests);
  app.get('/api/friends-requests/count', authenticate, getPendingCountRequests);
  app.post('/api/friend-requests/respond', authenticate, respondToFriendRequest);

  app.post('/api/keys/upload', authenticate, uploadKeys);
  app.get('/api/keys/:userId', authenticate, getKeysBundle);
  app.get('/api/keys/count/remaining', authenticate, getRemainingPreKeys);

  app.post('/api/devices/register', authenticate, registerDevice);
  app.delete('/api/devices/:deviceId', authenticate, unregisterDevice);
  app.post('/api/keys/one-time', authenticate, uploadOneTimeKeys);

  app.use('/api/media', mediaRoutes);

  // Проверка обновления приложения
  app.get('/api/updateapp', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const version = '1.0';
    const filePath = path.join(__dirname, '../apk/', `${version}.apk`);

    fs.stat(filePath, (err: any, stats: any) => {
      if (err) return res.status(404).json({ error: 'File not found' });
      res.json({
        latestVersion: version,
        changeLog: 'Bug fixes and performance improvements.',
        mandatoryUpdate: false,
        fileSize: stats.size
      });
    });
  });

  app.get('/api/apk/:version', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const { version } = req.params;
    // Версия — просто имя файла, валидируем чтобы не было traversal
    if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version' });
    }
    const filePath = path.join(__dirname, '../apk/', `${version}.apk`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${version}.apk"`);
    res.sendFile(filePath);
  });

  // История сообщений чата. chatId = id собеседника.
  // Авторизация: requester автоматически участник пары (chatKey из его id и chatId).
  app.get('/api/chats/:chatId/messages', authenticate, async (req: AuthRequest, res) => {
    try {
      const me = req.user!.id;
      const peerId = req.params.chatId as string;
      const since = req.query.since ? Number(req.query.since) : null;
      if (since !== null && !Number.isFinite(since)) {
        return res.status(400).json({ error: 'Invalid since' });
      }

      const chatKey = getChatKey(me, peerId);
      const messages = await prisma.message.findMany({
        where: {
          chatKey,
          ...(since ? { timestamp: { gt: new Date(since) } } : {})
        },
        orderBy: { timestamp: 'asc' },
        take: 500
      });

      res.json(messages.map(m => ({
        id: m.id,
        senderId: m.senderId,
        payload: m.payload,
        timestamp: m.timestamp.getTime(),
        delivered: m.deliveredAt !== null
      })));
    } catch (error) {
      console.error('History error:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // Список собеседников текущего пользователя (для глобального догона сообщений)
app.get('/api/chats', authenticate, async (req: AuthRequest, res) => {
  try {
    const me = req.user!.id;
    const rows = await prisma.message.findMany({
      where: {
        OR: [
          { chatKey: { startsWith: `${me}:` } },
          { chatKey: { endsWith: `:${me}` } }
        ]
      },
      select: { chatKey: true },
      distinct: ['chatKey']
    });
    const peers = rows
      .map(r => r.chatKey.split(':').find(p => p !== me))
      .filter((p): p is string => !!p);
    res.json(peers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

  app.get('/api/users/:userId/status', authenticate, (req, res) => {
    const userId = req.params.userId as string;
    res.json({ userId, isOnline: userSockets.has(userId) });
  });

  // === SOCKET.IO ===
  const io = new Server(server, { cors: corsOptions });

  // ⚠️ ВАЖНО: middleware регистрируется ЗДЕСЬ, до io.on('connection').
  // В предыдущей версии io.use был внутри connection и НЕ защищал подключения.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return next(new Error('unauthorized'));
    socket.data.userId = decoded.id;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const myUserId = socket.data.userId as string;
    console.log(`🔗 Client connected: ${socket.id} (user ${myUserId})`);

    const wasOffline = !userSockets.has(myUserId);
    addSocket(myUserId, socket.id);

    if (wasOffline) {
      socket.broadcast.emit('user_status', { userId: myUserId, isOnline: true, timestamp: Date.now() });
    }

    // Догоняем недоставленные сообщения из БД
    prisma.message.findMany({
      where: {
        deliveredAt: null,
        senderId: { not: myUserId },
        OR: [
          { chatKey: { startsWith: `${myUserId}:` } },
          { chatKey: { endsWith: `:${myUserId}` } }
        ]
      },
      orderBy: { timestamp: 'asc' },
      take: 200
    }).then(async (pending) => {
      for (const m of pending) {
        socket.emit('private_message', {
          from: m.senderId,
          payload: m.payload,
          messageId: m.id,
          timestamp: m.timestamp.getTime(),
          isOffline: true
        });
      }
      if (pending.length > 0) {
        await prisma.message.updateMany({
          where: { id: { in: pending.map(m => m.id) } },
          data: { deliveredAt: new Date() }
        });
        console.log(`📬 Sent ${pending.length} offline messages to ${myUserId}`);
      }
    }).catch(console.error);

    // join_room больше не принимает userId — личность из JWT (socket.data.userId)
    socket.on('join_room', () => {
      console.log(`👤 User ${myUserId} joined with socket ${socket.id}`);
    });

    socket.on('private_message', async (data) => {
      const from = socket.data.userId as string; // только из токена
      const { to, payload, messageId, typeMsg } = data || {};
      if (!from || !to || !payload || !messageId) return;

      const receiver = await prisma.user.findUnique({ where: { id: to }, select: { id: true } });
      if (!receiver) return;

      const chatKey = getChatKey(from, to);
      const ts = Date.now();

      // БД — источник истины. payload уже зашифрован клиентом (E2E).
      await prisma.message.upsert({
        where: { id: messageId },
        update: {},
        create: {
          id: messageId,
          chatKey,
          senderId: from,
          payload,
          typeMsg: typeof typeMsg === 'string' ? typeMsg : 'text',
          timestamp: new Date(ts)
        }
      });

      if (userSockets.has(to)) {
        emitToUser(io, to, 'private_message', { from, payload, messageId, timestamp: ts });
        // deliveredAt — best effort на emit; если пакет потерян, сообщение
        // всё равно останется в БД и придёт через history/offline-догон
        prisma.message.update({
          where: { id: messageId },
          data: { deliveredAt: new Date() }
        }).catch(() => {});
      } else {
        sendSilentMessagePush(to, from, messageId, payload, typeMsg ?? 'text');
      }
    });

    socket.on('message_action', (data) => {
      const from = socket.data.userId as string;
      if (!from) return;
      const { chatId, payload, messageId } = data || {};

      // chatId = id собеседника: шлём только ему
      emitToUser(io, chatId, 'message_action', {
        from, payload, messageId, timestamp: Date.now()
      });
    });

    socket.on('delivery_receipt', (data) => {
      const userId = socket.data.userId as string;
      if (!userId) return;
      const { messageId, chatId } = data || {};

      prisma.message.updateMany({
        where: { id: messageId },
        data: { deliveredAt: new Date() }
      }).catch(() => {});

      emitToUser(io, chatId, 'message_delivered', {
        messageId, deliveredBy: userId, timestamp: Date.now()
      });
    });

    socket.on('read_receipt', (data) => {
      const userId = socket.data.userId as string;
      if (!userId) return;
      const { messageId, chatId } = data || {};

      if (!readReceipts.has(messageId)) {
        readReceipts.set(messageId, { readBy: [], timestamp: Date.now() });
      }
      const receipt = readReceipts.get(messageId)!;
      if (!receipt.readBy.includes(userId)) receipt.readBy.push(userId);

      emitToUser(io, chatId, 'message_read', {
        messageId, readBy: userId, timestamp: Date.now()
      });
    });

    const handleTyping = (chatId: string, isTyping: boolean) => {
      const userId = socket.data.userId as string;
      if (!userId || !chatId) return;
      emitToUser(io, chatId, 'user_typing', {
        userId, chatId, isTyping, timestamp: Date.now()
      });
    };
    socket.on('typing_start', (d) => handleTyping(d?.chatId, true));
    socket.on('typing_stop', (d) => handleTyping(d?.chatId, false));

    socket.on('disconnect', () => {
      const fullyOffline = removeSocket(socket.id);
      if (fullyOffline) {
        console.log(`🔌 User ${fullyOffline} fully disconnected`);
        socket.broadcast.emit('user_status', {
          userId: fullyOffline, isOnline: false, timestamp: Date.now()
        });
      }
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
  });

  return { app, io, server };
};