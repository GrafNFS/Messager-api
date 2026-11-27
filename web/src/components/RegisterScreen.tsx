import { useState, useMemo } from 'react';
import { MessageSquare, Lock, User, Mail, Eye, EyeOff, Loader2, ArrowLeft, Check, X } from 'lucide-react';

interface RegisterScreenProps {
  onRegisterSuccess: (token: string, userId: string, username: string) => void;
  onSwitchToLogin: () => void;
}

export default function RegisterScreen({ onRegisterSuccess, onSwitchToLogin }: RegisterScreenProps) {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);

  // Валидация пароля в реальном времени
  const passwordValidation = useMemo(() => {
    const password = formData.password;
    return {
      minLength: password.length >= 6,
      hasUpper: /[A-Z]/.test(password),
      hasLower: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };
  }, [formData.password]);

  const passwordsMatch = formData.password === formData.confirmPassword && formData.confirmPassword.length > 0;

  const passwordStrength = useMemo(() => {
    const { minLength, hasUpper, hasLower, hasNumber, hasSpecial } = passwordValidation;
    let strength = 0;
    if (minLength) strength++;
    if (hasUpper && hasLower) strength++;
    if (hasNumber) strength++;
    if (hasSpecial) strength++;
    return strength;
  }, [passwordValidation]);

  const getStrengthColor = () => {
    if (passwordStrength <= 1) return 'bg-red-500';
    if (passwordStrength === 2) return 'bg-orange-500';
    if (passwordStrength === 3) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStrengthText = () => {
    if (passwordStrength <= 1) return 'Слабый';
    if (passwordStrength === 2) return 'Средний';
    if (passwordStrength === 3) return 'Хороший';
    return 'Надёжный';
  };

  const validateStep1 = () => {
    if (!formData.username.trim()) return 'Введите имя пользователя';
    if (formData.username.length < 3) return 'Имя пользователя должно содержать минимум 3 символа';
    if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) return 'Имя пользователя может содержать только буквы, цифры и подчеркивание';
    if (!formData.email.trim()) return 'Введите email';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Введите корректный email';
    if (!formData.password) return 'Введите пароль';
    if (passwordStrength < 2) return 'Пароль слишком слабый';
    if (!passwordsMatch) return 'Пароли не совпадают';
    return '';
  };

  const handleNext = () => {
    const validationError = validateStep1();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка регистрации');
      }

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user_id', data.user.id);
      localStorage.setItem('username', data.user.username);

      onRegisterSuccess(data.token, data.user.id, data.user.username);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Логотип */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-500 rounded-2xl shadow-lg mb-4">
            <MessageSquare className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Создать аккаунт</h1>
          <p className="text-gray-600 mt-2">Присоединяйтесь к IG Messenger</p>
        </div>

        {/* Форма */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Индикатор шагов */}
          <div className="flex items-center justify-center mb-6">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step >= 1 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              1
            </div>
            <div className={`w-12 h-1 mx-2 ${step >= 2 ? 'bg-blue-500' : 'bg-gray-200'}`}></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step >= 2 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              2
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 && (
              <>
                {/* Username */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Имя пользователя *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="username"
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Только буквы, цифры и подчеркивание</p>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="example@mail.com"
                      required
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Пароль *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Минимум 6 символов"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Индикатор силы пароля */}
                  {formData.password && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Надёжность пароля:</span>
                        <span className={`text-xs font-medium ${
                          passwordStrength <= 1 ? 'text-red-600' :
                          passwordStrength === 2 ? 'text-orange-600' :
                          passwordStrength === 3 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {getStrengthText()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className={`h-1.5 rounded-full transition-all duration-300 ${getStrengthColor()}`}
                          style={{ width: `${(passwordStrength / 4) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {/* Требования к паролю */}
                  <div className="mt-3 space-y-1">
                    <ValidationItem valid={passwordValidation.minLength} text="Минимум 6 символов" />
                    <ValidationItem valid={passwordValidation.hasUpper && passwordValidation.hasLower} text="Заглавные и строчные буквы" />
                    <ValidationItem valid={passwordValidation.hasNumber} text="Хотя бы одна цифра" />
                    <ValidationItem valid={passwordValidation.hasSpecial} text="Специальный символ (!@#$%^&*)" />
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Подтвердите пароль *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className={`w-full pl-10 pr-10 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                        formData.confirmPassword && !passwordsMatch 
                          ? 'border-red-300 focus:ring-red-500' 
                          : formData.confirmPassword && passwordsMatch
                          ? 'border-green-300 focus:ring-green-500'
                          : 'border-gray-300'
                      }`}
                      placeholder="Повторите пароль"
                      required
                    />
                    {formData.confirmPassword && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {passwordsMatch ? (
                          <Check className="w-5 h-5 text-green-500" />
                        ) : (
                          <X className="w-5 h-5 text-red-500" />
                        )}
                      </div>
                    )}
                  </div>
                  {formData.confirmPassword && !passwordsMatch && (
                    <p className="text-xs text-red-600 mt-1">Пароли не совпадают</p>
                  )}
                  {formData.confirmPassword && passwordsMatch && (
                    <p className="text-xs text-green-600 mt-1">Пароли совпадают</p>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                {/* Имя */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Имя</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="Иван"
                  />
                </div>

                {/* Фамилия */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Фамилия</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="Иванов"
                  />
                </div>

                {/* Сводка */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-blue-700"><strong>Username:</strong> @{formData.username}</p>
                  <p className="text-sm text-blue-700 mt-1"><strong>Email:</strong> {formData.email}</p>
                  <p className="text-sm text-blue-700 mt-1"><strong>Пароль:</strong> {'•'.repeat(formData.password.length)}</p>
                </div>
              </>
            )}

            {/* Ошибка */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Кнопки навигации */}
            <div className="flex gap-3">
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  <span>Назад</span>
                </button>
              )}
              <button
                type={step === 1 ? 'button' : 'submit'}
                onClick={step === 1 ? handleNext : undefined}
                disabled={loading}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Регистрация...</span>
                  </>
                ) : step === 1 ? (
                  <span>Далее</span>
                ) : (
                  <span>Создать аккаунт</span>
                )}
              </button>
            </div>
          </form>

          {/* Ссылка на вход */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <p>
              Уже есть аккаунт?{' '}
              <button
                onClick={onSwitchToLogin}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Войти
              </button>
            </p>
          </div>
        </div>

        {/* Футер */}
        <div className="text-center mt-6 text-sm text-gray-500">
          <p>🔒 End-to-End шифрование</p>
          <p className="mt-1">Ваши сообщения защищены</p>
        </div>
      </div>
    </div>
  );
}

function ValidationItem({ valid, text }: { valid: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      {valid ? (
        <Check className="w-4 h-4 text-green-500" />
      ) : (
        <X className="w-4 h-4 text-gray-400" />
      )}
      <span className={`text-xs ${valid ? 'text-green-600' : 'text-gray-500'}`}>
        {text}
      </span>
    </div>
  );
}