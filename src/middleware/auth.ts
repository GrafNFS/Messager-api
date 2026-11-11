import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Расширяем интерфейс Request для добавления поля user
export interface AuthRequest extends Request {
    user?: { id: string };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    // Проверяем наличие заголовка и формат "Bearer <token>"
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'your-super-secret-key'; // В продакшене используй .env!

    console.log(`[KEY] ⚠️ ${token} and ${secret}`);

    try {
        // Расшифровываем токен
        const decoded = jwt.verify(token, secret) as { id: string };
        console.log(`[KEY] ⚠️ ${token} and ${secret}`);
        req.user = { id: decoded.id }; // Сохраняем ID пользователя в запрос
        next(); // Передаём управление дальше
    } catch (error) {
        return res.status(403).json({ error: 'Unauthorized: Invalid or expired token' });
    }
};