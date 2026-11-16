import jwt from 'jsonwebtoken';

function getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set in environment');
    return secret;
}

export const generateToken = (userId: string): string => {
    return jwt.sign({ id: userId }, getSecret(), { expiresIn: '30d' });
};

export const verifyToken = (token: string): { id: string } | null => {
    try {
        return jwt.verify(token, getSecret()) as { id: string };
    } catch {
        return null;
    }
};