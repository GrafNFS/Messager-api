import { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import RegisterScreen from './components/RegisterScreen';
import MainApp from './components/MainApp';

type AuthScreen = 'login' | 'register';

function App() {
  const [currentScreen, setCurrentScreen] = useState<AuthScreen>('login');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userData, setUserData] = useState({
    token: '',
    userId: '',
    username: ''
  });

  // Проверяем авторизацию при загрузке
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const userId = localStorage.getItem('user_id');
    const username = localStorage.getItem('username');

    if (token && userId && username) {
      setIsAuthenticated(true);
      setUserData({ token, userId, username });
    }
  }, []);

  const handleLoginSuccess = (token: string, userId: string, username: string) => {
    setIsAuthenticated(true);
    setUserData({ token, userId, username });
  };

  const handleRegisterSuccess = (token: string, userId: string, username: string) => {
    setIsAuthenticated(true);
    setUserData({ token, userId, username });
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('username');
    setIsAuthenticated(false);
    setUserData({ token: '', userId: '', username: '' });
    setCurrentScreen('login');
  };

  const switchToLogin = () => setCurrentScreen('login');
  const switchToRegister = () => setCurrentScreen('register');

  if (isAuthenticated) {
    return (
      <MainApp 
        userId={userData.userId}
        username={userData.username}
        onLogout={handleLogout}
      />
    );
  }

  if (currentScreen === 'register') {
    return (
      <RegisterScreen 
        onRegisterSuccess={handleRegisterSuccess}
        onSwitchToLogin={switchToLogin}
      />
    );
  }

  return (
    <LoginScreen 
      onLoginSuccess={handleLoginSuccess}
      onSwitchToRegister={switchToRegister}
    />
  );
}

export default App;