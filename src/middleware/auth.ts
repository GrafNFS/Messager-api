import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Расширяем интерфейс Request для добавления поля user
export interface AuthRequest extends Request {
    user?: { id: string };
}

export function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        // Не стартуем с дефолтным секретом — это дыра. Падаем сразу.
        throw new Error('JWT_SECRET is not set in environment');
    }
    return secret;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, getJwtSecret()) as { id: string };
        req.user = { id: decoded.id };
        next();
    } catch {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
};