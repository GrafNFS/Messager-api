import { useState, useEffect } from 'react';
import { MessageSquare, Users, User, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import MessageComposer from './MessageComposer';

interface MainAppProps {
  userId: string;
  username: string;
  onLogout: () => void;
}

export default function MainApp({ userId, username, onLogout }: MainAppProps) {
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'profile'>('chats');
  const { socket, isConnected, joinRoom, onlineUsers } = useSocket();
  const [messages, setMessages] = useState<any[]>([]);

  // Подключаемся к комнате при загрузке
  useEffect(() => {
    if (isConnected && userId) {
      joinRoom();
    }
  }, [isConnected, userId, joinRoom]);

  // Слушаем входящие сообщения
  useEffect(() => {
    if (!socket) return;

    const handleIncoming = (data: any) => {
      console.log('📩 Received message:', data);
      setMessages(prev => [...prev, { ...data, receivedAt: Date.now() }]);
    };

    socket.on('private_message', handleIncoming);
    return () => {
      socket.off('private_message', handleIncoming);
    };
  }, [socket]);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* === БОКОВАЯ ПАНЕЛЬ === */}
      <div className={`
        w-full md:w-80 lg:w-96 bg-white border-r border-gray-200 flex flex-col
        ${activeTab !== 'chats' ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Хедер */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-blue-500">IG Messenger</h1>
            {isConnected ? (
              <Wifi size={16} className="text-green-500" />
            ) : (
              <WifiOff size={16} className="text-red-500" />
            )}
          </div>
          <button
            onClick={onLogout}
            className="text-gray-500 hover:text-red-500 transition-colors"
            title="Выйти"
          >
            <LogOut size={20} />
          </button>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' && (
            <div className="p-4">
              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700 mt-1">
                  <strong>Username:</strong> {username}
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  <strong>Статус:</strong> {isConnected ? '🟢 Онлайн' : '🔴 Оффлайн'}
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  <strong>Пользователей онлайн:</strong> {onlineUsers.size}
                </p>
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Входящие сообщения ({messages.length})
              </h3>
              <MessageComposer />
              {messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare size={40} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Пока нет сообщений</p>
                  <p className="text-xs mt-1">Отправь сообщение с телефона — оно придёт сюда!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {messages.slice(-10).reverse().map((msg, i) => (
                    <div key={i} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-xs text-gray-500">
                        От: <strong>{msg.from?.slice(0, 8)}...</strong>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        ID: {msg.messageId?.slice(0, 8)}...
                      </p>
                      <p className="text-xs text-gray-600 mt-2 break-all">
                        Payload: {JSON.stringify(msg.payload).slice(0, 60)}...
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="p-4 text-center text-gray-500">
              <Users size={48} className="mx-auto mb-2 opacity-50" />
              <p className="font-medium">Список контактов</p>
              <p className="text-sm mt-2">Скоро будет доступно</p>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="p-4 text-center text-gray-500">
              <User size={48} className="mx-auto mb-2 opacity-50" />
              <p className="font-medium">Профиль пользователя</p>
              <p className="text-sm mt-2">Скоро будет доступно</p>
            </div>
          )}
        </div>

        {/* Нижняя навигация (мобильная) */}
        <div className="md:hidden border-t border-gray-200 flex justify-around py-2 bg-white">
          <NavIcon icon={MessageSquare} label="Чаты" active={activeTab === 'chats'} onClick={() => setActiveTab('chats')} />
          <NavIcon icon={Users} label="Контакты" active={activeTab === 'contacts'} onClick={() => setActiveTab('contacts')} />
          <NavIcon icon={User} label="Профиль" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </div>
      </div>

      {/* === ОСНОВНАЯ ОБЛАСТЬ === */}
      <div className={`
        flex-1 bg-gray-50 flex flex-col
        ${activeTab === 'chats' ? 'hidden md:flex' : 'flex'}
      `}>
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <MessageSquare size={64} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Выберите чат или раздел</p>
            <p className="text-sm mt-2">для начала общения</p>
            <div className="mt-4 text-xs text-gray-500">
              {isConnected ? '✅ Подключено к серверу' : '⏳ Подключение...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavIcon({ icon: Icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
        active ? 'text-blue-500' : 'text-gray-500 hover:text-blue-500'
      }`}
    >
      <Icon size={24} />
      <span className="text-xs mt-1">{label}</span>
    </button>
  );
}