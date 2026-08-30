import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import { AUTH_DISABLED } from './utils/auth.js';

/**
 * Root application component. Handles top-level routing and auth state.
 */
export default function App() {
  const [hasToken, setHasToken] = useState(
    () => Boolean(localStorage.getItem('apex_token'))
  );
  // When auth is disabled the login screen is skipped entirely.
  const isAuthenticated = AUTH_DISABLED || hasToken;

  useEffect(() => {
    // Keep auth state in sync if the token is cleared/set elsewhere (e.g. another tab).
    const handleStorage = () => {
      setHasToken(Boolean(localStorage.getItem('apex_token')));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <Navigate to="/" replace />
            ) : (
              <Login onLogin={() => setHasToken(true)} />
            )
          }
        />
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <Dashboard onLogout={() => setHasToken(false)} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
