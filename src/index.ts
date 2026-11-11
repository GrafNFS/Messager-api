import { startServer } from './server';
import { config } from 'dotenv';

config(); // Загружаем .env

const PORT = process.env.PORT || 3000;

startServer(PORT);
