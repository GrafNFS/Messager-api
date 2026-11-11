import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;

    // 1. Проверяем, нет ли уже такого пользователя
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // 2. Хешируем пароль
    const passwordHash = await hashPassword(password);

    // 3. Создаем пользователя в БД
    // Примечание: Поля phone, avatarUrl опциональны, поэтому их нет в запросе
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        displayName: `${firstName} ${lastName}`.trim()
      }
    });

    // 4. Создаем запись крипто-ключей (пока пустую, заполним позже)
    await prisma.cryptoKeys.create({
  data: {
    userId: user.id,
    identityKey: 'pending', // Заглушка
    signedPreKeyId: 0,
    signedPreKeyPublic: '',
    signedPreKeySig: '',
    registrationId: Math.floor(Math.random() * 16380) + 1, // ✅ Случайный registrationId (1..16383)
  },
});

    // 5. Генерируем токен
    const token = generateToken(user.id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // 1. Ищем пользователя (по email или username)
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: username }, { username }] }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 2. Сравниваем пароли
    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 3. Генерируем токен
    const token = generateToken(user.id);

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
