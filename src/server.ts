import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from './middleware/auth';
import { verifyToken } from './utils/jwt';
import path from 'path';

import { registerDevice, unregisterDevice, sendSilentMessagePush } from './controllers/device.controller';
import { register, login } from './controllers/auth.controller';
import {
  uploadKeys, getDevicesBundle, getIdentityKey, getRemainingPreKeys, uploadOneTimeKeys
} from './controllers/keys.controller';
import {
  getMyContacts, searchUsers, addContact, getMyProfile, updateMyProfile,
  sendFriendRequest, getPendingRequests, respondToFriendRequest, getPendingCountRequests
} from './controllers/user.controller';
import {
  createGroup, getMyGroups, addGroupMember, removeGroupMember, getGroupMembers
} from './controllers/group.controller';
import mediaRoutes from './routes/mediaRoutes';

const prisma = new PrismaClient();

// ✅ Страховка: одна необработанная ошибка в сокет-хендлере не должна ронять процесс
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception:', err);
});

// === СОСТОЯНИЕ СОКЕТОВ ===
// userId -> Set<socketId>; deviceId каждого сокета — в socket.data.deviceId
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
      return userId;
    }
  }
  return null;
};

const emitToUser = (io: Server, userId: string, event: string, data: any) => {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit(event, data);
};

// 🌟 Мульти-девайс: отправка конкретному устройству пользователя
const emitToUserDevice = (io: Server, userId: string, deviceId: string, event: string, data: any) => {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const sid of set) {
    const s = io.sockets.sockets.get(sid);
    if (s && (s.data.deviceId || '1') === deviceId) {
      s.emit(event, data);
    }
  }
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
  app.use(express.json({ limit: '2mb' }));

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

  app.get('/api/users/search', authenticate, searchUsers);
  app.get('/api/myprofile', authenticate, getMyProfile);
  app.put('/api/myprofile', authenticate, updateMyProfile);

  app.post('/api/contacts', authenticate, addContact);
  app.get('/api/contacts', authenticate, getMyContacts);

  app.post('/api/friend-requests', authenticate, sendFriendRequest);
  app.get('/api/friend-requests/pending', authenticate, getPendingRequests);
  app.get('/api/friends-requests/count', authenticate, getPendingCountRequests);
  app.post('/api/friend-requests/respond', authenticate, respondToFriendRequest);

  // === КЛЮЧИ (мульти-девайс) ===
  app.post('/api/keys/upload', authenticate, uploadKeys);
  app.get('/api/keys/count/remaining', authenticate, getRemainingPreKeys);
  app.post('/api/keys/one-time', authenticate, uploadOneTimeKeys);
  app.get('/api/keys/:userId/identity', authenticate, getIdentityKey);
  // Бандлы всех устройств пользователя (НОВЫЙ формат ответа: {devices:[...]})
  app.get('/api/keys/:userId', authenticate, getDevicesBundle);

  app.post('/api/devices/register', authenticate, registerDevice);
  app.delete('/api/devices/:deviceId', authenticate, unregisterDevice);

  // === ГРУППОВЫЕ ЧАТЫ ===
  app.post('/api/groups', authenticate, createGroup);
  app.get('/api/groups', authenticate, getMyGroups);
  app.get('/api/groups/:groupId/members', authenticate, getGroupMembers);
  app.post('/api/groups/:groupId/members', authenticate, addGroupMember);
  app.delete('/api/groups/:groupId/members/:userId', authenticate, removeGroupMember);

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

  // Список чатов: прямые собеседники + мои группы (для глобального догона)
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

      const myGroups = await prisma.groupMember.findMany({
        where: { userId: me },
        select: { groupId: true }
      });
      const groupKeys = myGroups.map(g => `group:${g.groupId}`);
      const groupMsgs = groupKeys.length
        ? await prisma.message.findMany({
            where: { chatKey: { in: groupKeys } },
            select: { chatKey: true },
            distinct: ['chatKey']
          })
        : [];
      const groupIds = groupMsgs.map(g => g.chatKey.substring('group:'.length));

      res.json([...peers, ...groupIds]);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch chats' });
    }
  });

  // История сообщений чата. chatId = id собеседника ИЛИ id группы.
  app.get('/api/chats/:chatId/messages', authenticate, async (req: AuthRequest, res) => {
    try {
      const me = req.user!.id;
      const peerId = req.params.chatId as string;
      const since = req.query.since ? Number(req.query.since) : null;
      if (since !== null && !Number.isFinite(since)) {
        return res.status(400).json({ error: 'Invalid since' });
      }

      const isGroup = await prisma.group.findUnique({ where: { id: peerId }, select: { id: true } });
      const chatKey = isGroup ? `group:${peerId}` : getChatKey(me, peerId);
      if (isGroup) {
        const isMember = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId: peerId, userId: me } }
        });
        if (!isMember) return res.status(403).json({ error: 'Not a group member' });
      }

      const messages = await prisma.message.findMany({
        where: { chatKey, ...(since ? { timestamp: { gt: new Date(since) } } : {}) },
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

  app.get('/api/users/:userId/status', authenticate, (req, res) => {
    const userId = req.params.userId as string;
    res.json({ userId, isOnline: userSockets.has(userId) });
  });

  // === SOCKET.IO ===
  const io = new Server(server, { cors: corsOptions });

  // Личность из JWT + deviceId из handshake (для мульти-девайс доставки)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return next(new Error('unauthorized'));
    socket.data.userId = decoded.id;
    socket.data.deviceId = String(socket.handshake.auth?.deviceId || '1');
    next();
  });

  // Маршрутизация групповых событий из контроллеров (системные сообщения)
  app.set('groupEmit', (groupId: string, event: string, data: any) => {
    prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } })
      .then(members => { for (const m of members) emitToUser(io, m.userId, event, data); })
      .catch(console.error);
  });

  io.on('connection', (socket: Socket) => {
    const myUserId = socket.data.userId as string;
    const myDeviceId = (socket.data.deviceId as string) || '1';
    console.log(`🔗 Client connected: ${socket.id} (user ${myUserId}, device ${myDeviceId})`);

    const wasOffline = !userSockets.has(myUserId);
    addSocket(myUserId, socket.id);

    if (wasOffline) {
      socket.broadcast.emit('user_status', { userId: myUserId, isOnline: true, timestamp: Date.now() });
    }

    // Догон недоставленных сообщений из БД
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
        // Мульти-девайс: отдаём только entry для ЭТОГО устройства
        let entry: any = null;
        let fromDeviceId = '1';
        const p: any = m.payload;
        if (p && Array.isArray(p.payloads)) {
          fromDeviceId = p.fromDeviceId || '1';
          const isGroupPayload = p.payloads.length > 0 && p.payloads[0].userId !== undefined;
          entry = isGroupPayload
            ? p.payloads.find((x: any) => x.userId === myUserId && x.deviceId === myDeviceId)
            : p.payloads.find((x: any) => x.deviceId === myDeviceId);
        } else if (p && p.type !== undefined) {
          entry = p; // легаси single-device
        }
        if (!entry) continue;

        socket.emit('private_message', {
          from: m.senderId,
          fromDeviceId,
          payload: { type: entry.type, data: entry.data },
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

    socket.on('join_room', () => {
      console.log(`👤 User ${myUserId} (device ${myDeviceId}) joined`);
    });

    // === ЛИЧНЫЕ СООБЩЕНИЯ (мульти-девайс) ===
    // Клиент присылает payloads: [{deviceId, type, data}] — по entry на каждое
    // устройство получателя. Легаси-формат {type,data} тоже принимается.
    socket.on('private_message', async (data) => {
      const from = socket.data.userId as string;
      const { to, payloads, payload, messageId, typeMsg } = data || {};
      if (!from || !to || !messageId) return;
      if (!payloads && !payload) return;

      const normPayloads: any[] = Array.isArray(payloads)
        ? payloads
        : [{ deviceId: '1', type: payload.type, data: payload.data }];

      try {
        const receiver = await prisma.user.findUnique({ where: { id: to }, select: { id: true } });
        if (!receiver) return;

        const chatKey = getChatKey(from, to);
        const ts = Date.now();

        const existing = await prisma.message.findUnique({ where: { id: messageId } });
        if (existing) {
          // Повторная отправка: догоняем доставку недоставленным устройствам
          const p: any = existing.payload;
          const list: any[] = p?.payloads ?? [];
          for (const sid of userSockets.get(to) ?? []) {
            const s = io.sockets.sockets.get(sid);
            const dev = (s?.data.deviceId as string) || '1';
            const entry = list.find((x: any) => x.deviceId === dev);
            if (entry && s) {
              s.emit('private_message', { from, fromDeviceId: p?.fromDeviceId || '1', payload: { type: entry.type, data: entry.data }, messageId, timestamp: ts });
            }
          }
          if (!existing.deliveredAt) {
            await prisma.message.update({ where: { id: messageId }, data: { deliveredAt: new Date() } }).catch(() => {});
          }
          return;
        }

        try {
          await prisma.message.create({
            data: {
              id: messageId,
              chatKey,
              senderId: from,
              payload: { fromDeviceId: myDeviceId, payloads: normPayloads },
              typeMsg: typeof typeMsg === 'string' ? typeMsg : 'text',
              timestamp: new Date(ts)
            }
          });
        } catch (e: any) {
          if (e?.code === 'P2002') return;
          throw e;
        }

        // Доставка: каждому онлайн-сокету — entry его устройства
        const set = userSockets.get(to);
        let deliveredAny = false;
        if (set) {
          for (const sid of set) {
            const s = io.sockets.sockets.get(sid);
            const dev = (s?.data.deviceId as string) || '1';
            const entry = normPayloads.find((x: any) => x.deviceId === dev);
            if (entry && s) {
              s.emit('private_message', {
                from, fromDeviceId: myDeviceId,
                payload: { type: entry.type, data: entry.data },
                messageId, timestamp: ts
              });
              deliveredAny = true;
            }
          }
        }
        if (deliveredAny) {
          prisma.message.update({ where: { id: messageId }, data: { deliveredAt: new Date() } }).catch(() => {});
        } else {
          sendSilentMessagePush(to, from, messageId, normPayloads[0], typeMsg ?? 'text');
        }
      } catch (e) {
        console.error('private_message error:', e);
      }
    });

    // === ГРУППОВЫЕ СООБЩЕНИЯ (мульти-девайс) ===
    // payloads: [{userId, deviceId, type, data}]
    socket.on('group_message', async (data) => {
      const from = socket.data.userId as string;
      const { groupId, payloads, messageId, typeMsg } = data || {};
      if (!from || !groupId || !Array.isArray(payloads) || !messageId) return;

      try {
        const membership = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: from } }
        });
        if (!membership) return;

        const members = await prisma.groupMember.findMany({
          where: { groupId, userId: { not: from } },
          select: { userId: true }
        });
        const chatKey = `group:${groupId}`;
        const ts = Date.now();

        const existing = await prisma.message.findUnique({ where: { id: messageId } });
        if (existing) return;
        try {
          await prisma.message.create({
            data: {
              id: messageId,
              chatKey,
              senderId: from,
              payload: { fromDeviceId: myDeviceId, payloads },
              typeMsg: typeof typeMsg === 'string' ? typeMsg : 'text',
              timestamp: new Date(ts)
            }
          });
        } catch (e: any) {
          if (e?.code === 'P2002') return;
          throw e;
        }

        for (const uid of members.map(m => m.userId)) {
          const set = userSockets.get(uid);
          if (!set) {
            // Оффлайн-пуш (первый entry как «намёк»)
            const anyEntry = payloads.find((x: any) => x.userId === uid);
            if (anyEntry) sendSilentMessagePush(uid, from, messageId, { type: anyEntry.type, data: anyEntry.data }, typeMsg ?? 'text');
            continue;
          }
          for (const sid of set) {
            const s = io.sockets.sockets.get(sid);
            const dev = (s?.data.deviceId as string) || '1';
            const entry = payloads.find((x: any) => x.userId === uid && x.deviceId === dev);
            if (entry && s) {
              s.emit('group_message', {
                groupId, from, fromDeviceId: myDeviceId,
                payload: { type: entry.type, data: entry.data },
                messageId, timestamp: ts
              });
            }
          }
        }
      } catch (e) {
        console.error('group_message error:', e);
      }
    });

    // === ДЕЙСТВИЯ С СООБЩЕНИЯМИ (edit/delete) — тоже мульти-девайс ===
    // payloads: [{deviceId, type, data}]; легаси {type,data} принимается
    socket.on('message_action', (data) => {
      const from = socket.data.userId as string;
      if (!from) return;
      const { chatId, payloads, payload, messageId } = data || {};
      if (!chatId) return;

      const normPayloads: any[] = Array.isArray(payloads)
        ? payloads
        : [{ deviceId: '1', type: payload.type, data: payload.data }];

      const set = userSockets.get(chatId);
      if (set) {
        for (const sid of set) {
          const s = io.sockets.sockets.get(sid);
          const dev = (s?.data.deviceId as string) || '1';
          const entry = normPayloads.find((x: any) => x.deviceId === dev);
          if (entry && s) {
            s.emit('message_action', {
              from, fromDeviceId: myDeviceId,
              payload: { type: entry.type, data: entry.data },
              messageId, timestamp: Date.now()
            });
          }
        }
      }
    });

    socket.on('delivery_receipt', (data) => {
      const userId = socket.data.userId as string;
      if (!userId) return;
      const { messageId, chatId } = data || {};

      prisma.message.updateMany({ where: { id: messageId }, data: { deliveredAt: new Date() } }).catch(() => {});

      emitToUser(io, chatId, 'message_delivered', { messageId, deliveredBy: userId, timestamp: Date.now() });
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

      emitToUser(io, chatId, 'message_read', { messageId, readBy: userId, timestamp: Date.now() });
    });

    const handleTyping = (chatId: string, isTyping: boolean) => {
      const userId = socket.data.userId as string;
      if (!userId || !chatId) return;
      emitToUser(io, chatId, 'user_typing', { userId, chatId, isTyping, timestamp: Date.now() });
    };
    socket.on('typing_start', (d) => handleTyping(d?.chatId, true));
    socket.on('typing_stop', (d) => handleTyping(d?.chatId, false));

    // Тайпинг в группах: ретрансляция остальным участникам
    socket.on('group_typing', async (data) => {
      const from = socket.data.userId as string;
      const { groupId, isTyping } = data || {};
      if (!from || !groupId) return;
      try {
        const membership = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: from } }
        });
        if (!membership) return;

        const members = await prisma.groupMember.findMany({
          where: { groupId, userId: { not: from } },
          select: { userId: true }
        });
        for (const m of members) {
          emitToUser(io, m.userId, 'group_typing', {
            groupId, userId: from, isTyping: !!isTyping, timestamp: Date.now()
          });
        }
      } catch (e) {
        console.error('group_typing error:', e);
      }
    });

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

  // ✅ ШАГ 1: Отдаем статические файлы (CSS, JS, картинки) из папки сборки
const webDistPath = path.join(__dirname, '../web/dist');
app.use(express.static(webDistPath));

// ✅ ШАГ 2: BULLETPROOF SPA FALLBACK (Обходит проблему с path-to-regexp)
// Мы используем app.use БЕЗ указания пути, чтобы перехватить всё, 
// что не было обработано предыдущими роутами (API или статикой)
app.use((req, res, next) => {
  // Если запрос идет к API или сокетам, пропускаем его (хотя они уже должны были обработаться)
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  
  // Для всех остальных запросов (например, /, /chats, /profile) отдаем index.html
  res.sendFile(path.join(webDistPath, 'index.html'), (err) => {
    if (err) {
      console.error('❌ Ошибка при отдаче index.html:', err);
      res.status(500).send('Ошибка загрузки приложения. Попробуйте обновить страницу.');
    }
  });
});

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
  });

  return { app, io, server };
};
