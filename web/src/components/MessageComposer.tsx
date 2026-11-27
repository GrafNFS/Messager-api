import { useState } from 'react';
import { Send } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

export default function MessageComposer() {
  const { sendMessage, isConnected } = useSocket();
  const [to, setTo] = useState('');
  const [toPublicKey, setToPublicKey] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');

  const handleSend = async () => {
    if (!to || !toPublicKey || !text) return;
    setStatus('Шифрование...');
    const ok = await sendMessage(to, toPublicKey, text);
    setStatus(ok ? '✅ Отправлено' : '❌ Ошибка');
    if (ok) setText('');
  };

  return (
    <div className="border-t border-gray-200 p-3 space-y-2">
      <input
        type="text"
        placeholder="ID получателя (userId)"
        value={to}
        onChange={e => setTo(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg text-sm"
      />
      <input
        type="text"
        placeholder="Публичный ключ получателя (Base64)"
        value={toPublicKey}
        onChange={e => setToPublicKey(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg text-sm font-mono text-xs"
      />
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Сообщение..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
          disabled={!isConnected}
        />
        <button
          onClick={handleSend}
          disabled={!isConnected || !to || !toPublicKey || !text}
          className="bg-blue-500 text-white p-2 rounded-lg disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>
      {status && <p className="text-xs text-gray-500">{status}</p>}
    </div>
  );
}