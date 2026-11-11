import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { authenticate } from './middleware/auth';

// Существующие контроллеры
import { registerDevice, unregisterDevice, sendSilentMessagePush } from './controllers/device.controller';
import { register, login } from './controllers/auth.controller';
import { uploadKeys, getKeysBundle } from './controllers/keys.controller';
import { getMyContacts, searchUsers, addContact, getMyProfile, updateMyProfile, sendFriendRequest, getPendingRequests, respondToFriendRequest, getPendingCountRequests} from './controllers/user.controller';

// ✅ НОВОЕ: Импорт роутера для работы с медиа (файлами)
import mediaRoutes from './routes/mediaRoutes'; 

// === ХРАНИЛИЩА (на уровне модуля) ===
const offlineMessages = new Map<string, Array<{
  id: string;
  senderId: string;
  payload: any;
  timestamp: number;
  delivered: boolean;
}>>();

const readReceipts = new Map<string, { readBy: string[]; timestamp: number }>();

const getChatKey = (id1: string, id2: string): string => {
  return [id1, id2].sort().join(':');
};

function saveMessageToHistory(chatKey: string, message: {
  id: string;
  senderId: string;
  payload: any;
  timestamp: number;
  delivered: boolean;
}) {
  if (!offlineMessages.has(chatKey)) {
    offlineMessages.set(chatKey, []);
  }
  const messages = offlineMessages.get(chatKey)!;
  messages.push(message);

  if (messages.length > 100) {
    messages.shift();
  }
}

function sendOfflineMessages(userId: string, socket: any) {
  for (const [chatKey, messages] of offlineMessages.entries()) {
    if (chatKey.split(':').includes(userId)) {
      const pending = messages.filter(m => !m.delivered && m.senderId !== userId);

      for (const msg of pending) {
        socket.emit('private_message', {
          from: msg.senderId,
          payload: msg.payload,
          messageId: msg.id,
          timestamp: msg.timestamp,
          isOffline: true
        });
        msg.delivered = true;
      }

      if (pending.length > 0) {
        console.log(`📬 Sent ${pending.length} offline messages to ${userId}`);
      }
    }
  }
}

export const startServer = (port: number) => {
  const app = express();
  const server = http.createServer(app);

  // Middleware
  app.use(helmet());
  app.use(cors({ origin: '*' }));
  // app.use(compression()); 

  app.use(express.json({ limit: '50mb' })); // ⚠️ Важно: для загрузки файлов через multipart этот лимит не влияет, он только для JSON

  // === API ROUTES ===
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/api/register', register);
  app.post('/api/login', login);

  app.get('/api/users/search', searchUsers);
  app.get('/myprofile', authenticate, getMyProfile);
  app.put('/myprofile', authenticate, updateMyProfile);
  app.post('/api/contacts', addContact);
  app.get('/api/contacts', getMyContacts);

  app.post('/api/friend-requests', sendFriendRequest);
  app.get('/api/friend-requests/pending', getPendingRequests);
  app.get('/api/frends-requests/count', getPendingCountRequests)
  app.post('/api/friend-requests/respond', respondToFriendRequest);

  app.post('/api/keys/upload', uploadKeys);
  app.get('/api/keys/:userId', getKeysBundle);

  app.post('/api/devices/register', registerDevice);
  app.delete('/api/devices/:deviceId', unregisterDevice);

  // ✅ НОВОЕ: Подключаем роутер медиа. 
  app.use('/api/media', mediaRoutes);

  //Проверка обнавления
  app.get('/api/updateapp', (req, res) => {
    const express = require('express');
    const fs = require('fs');
    const path = require('path');
    const version = "1.0"
    const filePath = path.join(__dirname, '../apk/', `${version}.apk`);
      
      fs.stat(filePath, (err, stats) => {
        if (err) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        const jesUpdateApp = {
          "latestVersion": version,
          "changeLog": "Bug fixes and performance improvements.",
          "mandatoryUpdate": false,
          "fileSize": stats.size
        }
        res.json(jesUpdateApp);
      });
  });

  app.get('/api/apk/:version', (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const { version } = req.params;
      const filePath = path.join(__dirname, '../apk/', `${version}.apk`);
      
      console.log(`🔍 DOWNLOAD DEBUG: ApkName=[${version}]`);
      console.log(`🔍 DOWNLOAD DEBUG: UPLOAD_DIR=[../apk/]`);
      console.log(`🔍 DOWNLOAD DEBUG: filePath=[${filePath}]`);
      console.log(`🔍 DOWNLOAD DEBUG: exists=${fs.existsSync(filePath)}`);
      
      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found at path: ${filePath}`);
        res.status(404).json({ error: 'File not found' });
        return;
      }
      
      console.log(`✅ File found! Starting download: ${version}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${version}.apk"`);
      res.sendFile(filePath);
      
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ error: 'Download failed' });
    }
  });

  // === НОВЫЙ ENDPOINT: Получить историю сообщений чата ===
  app.get('/api/chats/:chatId/messages', (req, res) => {
    const { chatId } = req.params;
    const { since } = req.query;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    console.log(`📥 Fetching messages for chat: ${chatId}, user: ${userId}`);

    const chatKey = getChatKey(userId, chatId);
    const messages = offlineMessages.get(chatKey) || [];

    const filtered = since
      ? messages.filter(m => m.timestamp > Number(since))
      : messages;

    filtered.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`✅ Found ${filtered.length} messages for chat ${chatKey}`);
    res.json(filtered);
  });

  app.get('/api/users/:userId/status', (req, res) => {
    const { userId } = req.params;
    // ⚠️ Внимание: userSockets объявлен ниже, внутри io.on. 
    // Лучше вынести userSockets на уровень модуля (как offlineMessages), чтобы этот роут работал.
    // Я исправлю это в коде ниже 👇
    const isOnline = userSockets.has(userId);
    res.json({ userId, isOnline });
  });

  // === SOCKET.IO ===
  const io = new Server(server, { cors: { origin: '*' } });

  // ✅ ИСПРАВЛЕНИЕ: Выносим хранилища сокетов на уровень модуля, 
  // чтобы роут /api/users/:userId/status мог к ним обращаться
  const userSockets = new Map<string, string>();
  const socketUsers = new Map<string, string>();

  io.on('connection', (socket) => {
    console.log(`🔗 Client connected: ${socket.id}`);

    socket.on('join_room', (data) => {
      const { userId } = data;
      userSockets.set(userId, socket.id);
      socketUsers.set(socket.id, userId);
      console.log(`👤 User ${userId} joined with socket ${socket.id}`);

      socket.broadcast.emit('user_status', {
        userId,
        isOnline: true,
        timestamp: Date.now()
      });
      console.log(`📢 Broadcasted: User ${userId} is online`);

      sendOfflineMessages(userId, socket);
    });

    socket.on('private_message', (data) => {
      const { to, payload, messageId } = data;
      const from = socketUsers.get(socket.id);

      if (!from) return;

      const receiverSocketId = userSockets.get(to);
      const chatKey = getChatKey(from, to);

      if (receiverSocketId) {
        // Обычная логика: Получатель онлайн, шлем по быстрому сокету
        io.to(receiverSocketId).emit('private_message', {
          from,
          payload,
          messageId,
          timestamp: Date.now()
        });

        saveMessageToHistory(chatKey, {
          id: messageId,
          senderId: from,
          payload,
          timestamp: Date.now(),
          delivered: true
        });
        console.log(`📩 Message ${messageId} sent from ${from} to ${to}`);
      } else {
        // Получатель оффлайн: Сохраняем в оффлайн мапу сокета
        saveMessageToHistory(chatKey, {
          id: messageId,
          senderId: from,
          payload,
          timestamp: Date.now(),
          delivered: false
        });
        console.log(`💾 Message ${messageId} saved for offline user ${to}`);

        // 🌟 ИСПРАВЛЕНИЕ: Вызываем наш новый метод пуша из контроллера Prisma!
        // Firebase разбудит Android, сервис MyFirebaseMessagingService расшифрует payload и запишет в Room
        sendSilentMessagePush(to, from, messageId, payload);
      }
    });

    socket.on('message_action', (data) => {
      const { chatId, payload, messageId } = data;
      const from = socketUsers.get(socket.id);
      if (!from) return;

      for (const [key, socketId] of userSockets.entries()) {
        if (key !== from) {
          io.to(socketId).emit('message_action', {
            from,
            payload,
            messageId,
            timestamp: Date.now()
          });
        }
      }
      console.log(`⚡ Action sent from ${from} in chat ${chatId}`);
    });

    socket.on('delivery_receipt', (data) => {
      const { messageId, chatId } = data;
      const userId = socketUsers.get(socket.id);
      if (!userId) return;

      const chatKey = getChatKey(userId, chatId);
      let sentCount = 0;

      for (const [key, socketId] of userSockets.entries()) {
        if (key !== userId && chatKey.split(':').includes(key)) {
          io.to(socketId).emit('message_delivered', {
            messageId,
            deliveredBy: userId,
            timestamp: Date.now()
          });
          sentCount++;
        }
      }
      console.log(`✅ Server forwarded delivery_receipt for ${messageId} to ${sentCount} recipients user ${userId} to ${chatId}`);
    });

    socket.on('read_receipt', (data) => {
      const { messageId, chatId } = data;
      const userId = socketUsers.get(socket.id);

      if (!userId) return;

      if (!readReceipts.has(messageId)) {
        readReceipts.set(messageId, { readBy: [], timestamp: Date.now() });
      }
      const receipt = readReceipts.get(messageId)!;
      if (!receipt.readBy.includes(userId)) {
        receipt.readBy.push(userId);
      }

      const chatKey = getChatKey(userId, chatId);

      for (const [key, socketId] of userSockets.entries()) {
        if (key !== userId && chatKey.split(':').includes(key)) {
          io.to(socketId).emit('message_read', {
            messageId,
            readBy: userId,
            timestamp: Date.now()
          });
        }
      }
      console.log(`✅ Read receipt for ${messageId} from ${userId} to ${chatId}`);
    });

    socket.on('typing_start', (data) => {
      const { chatId } = data;
      const userId = socketUsers.get(socket.id);
      if (!userId) return;

      const chatKey = getChatKey(userId, chatId);

      for (const [key, socketId] of userSockets.entries()) {
        if (key !== userId && chatKey.split(':').includes(key)) {
          io.to(socketId).emit('user_typing', {
            userId,
            chatId,
            isTyping: true,
            timestamp: Date.now()
          });
        }
      }
      console.log(`✍️ ${userId} started typing in chat ${chatId}`);
    });

    socket.on('typing_stop', (data) => {
      const { chatId } = data;
      const userId = socketUsers.get(socket.id);
      if (!userId) return;

      const chatKey = getChatKey(userId, chatId);

      for (const [key, socketId] of userSockets.entries()) {
        if (key !== userId && chatKey.split(':').includes(key)) {
          io.to(socketId).emit('user_typing', {
            userId,
            chatId,
            isTyping: false,
            timestamp: Date.now()
          });
        }
      }
      console.log(`🛑 ${userId} stopped typing in chat ${chatId}`);
    });

    socket.on('disconnect', () => {
      const userId = socketUsers.get(socket.id);
      if (userId) {
        userSockets.delete(userId);
        socketUsers.delete(socket.id);
        console.log(`🔌 User ${userId} disconnected`);

        socket.broadcast.emit('user_status', {
          userId,
          isOnline: false,
          timestamp: Date.now()
        });
        console.log(`📢 Broadcasted: User ${userId} is offline`);
      }
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📝 API: https://messenger.insolent-castoms.ru/api`);
  });

  return { app, io, server };
};