import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import serviceAccount from '../firebase-service-account.json';

// Инициализируем только если приложение еще не запущено
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount as any),
  });
}

const messaging = getMessaging();

export { messaging };