import { useState } from 'react'
import { MessageSquare, Users, User, Settings } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'profile'>('chats')

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900">
      
      {/* === БОКОВАЯ ПАНЕЛЬ (список чатов/контактов) === */}
      <div className={`
        w-full md:w-80 lg:w-96 bg-white border-r border-gray-200 flex flex-col
        ${activeTab !== 'chats' ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Хедер */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <h1 className="text-xl font-bold text-blue-500">IG Messenger</h1>
          <Settings size={20} className="text-gray-500 cursor-pointer hover:text-blue-500" />
        </div>

        {/* Контент в зависимости от вкладки */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' && (
            <div className="p-4 text-center text-gray-500">
              <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
              <p>Список чатов</p>
              <p className="text-sm mt-2">Подключается к серверу...</p>
            </div>
          )}
          {activeTab === 'contacts' && (
            <div className="p-4 text-center text-gray-500">
              <Users size={48} className="mx-auto mb-2 opacity-50" />
              <p>Список контактов</p>
            </div>
          )}
          {activeTab === 'profile' && (
            <div className="p-4 text-center text-gray-500">
              <User size={48} className="mx-auto mb-2 opacity-50" />
              <p>Профиль пользователя</p>
            </div>
          )}
        </div>

        {/* Нижняя навигация (ТОЛЬКО для мобильных) */}
        <div className="md:hidden border-t border-gray-200 flex justify-around py-2 bg-white">
          <NavIcon 
            icon={MessageSquare} 
            label="Чаты" 
            active={activeTab === 'chats'} 
            onClick={() => setActiveTab('chats')} 
          />
          <NavIcon 
            icon={Users} 
            label="Контакты" 
            active={activeTab === 'contacts'} 
            onClick={() => setActiveTab('contacts')} 
          />
          <NavIcon 
            icon={User} 
            label="Профиль" 
            active={activeTab === 'profile'} 
            onClick={() => setActiveTab('profile')} 
          />
        </div>
      </div>

      {/* === ОСНОВНАЯ ОБЛАСТЬ (чат или детали) === */}
      <div className={`
        flex-1 bg-gray-50 flex flex-col
        ${activeTab === 'chats' ? 'hidden md:flex' : 'flex'} 
      `}>
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <MessageSquare size={64} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">Выберите чат или раздел</p>
            <p className="text-sm mt-2">для начала общения</p>
          </div>
        </div>
      </div>

    </div>
  )
}

// Вспомогательный компонент для иконок навигации
function NavIcon({ icon: Icon, label, active, onClick }: { 
  icon: any
  label: string
  active: boolean
  onClick: () => void
}) {
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
  )
}

export default App