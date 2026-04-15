/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API, updateAPI } from './api';

// User type matching backend model
export interface User {
  id: number;
  username: string;
  email?: string;
  role: number;
  quota: number;
  used_quota: number;
  display_name?: string;
  avatar?: string;
  status: number;
}

// API response types
interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

interface LoginResponse {
  require_2fa?: boolean;
  user?: User;
}

export interface RegisterParams {
  username: string;
  password: string;
  email: string;
  verification_code?: string;
  aff_code?: string;
  turnstile?: string;
}

// Auth context type
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; message: string; require2FA?: boolean }>;
  register: (params: RegisterParams) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Get user from localStorage
function getUserFromStorage(): User | null {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// Save user to localStorage
function saveUserToStorage(user: User): void {
  localStorage.setItem('user', JSON.stringify(user));
}

// Remove user from localStorage
function removeUserFromStorage(): void {
  localStorage.removeItem('user');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getUserFromStorage());

  // Sync user state with localStorage on mount
  useEffect(() => {
    const storedUser = getUserFromStorage();
    setUser(storedUser);
  }, []);

  // Refresh user from localStorage (useful after external updates)
  const refreshUser = () => {
    setUser(getUserFromStorage());
  };

  // Login function
  const login = async (username: string, password: string) => {
    try {
      const res = await API.post<ApiResponse<LoginResponse>>('/api/user/login', {
        username,
        password,
      });

      const { success, message, data } = res.data;

      if (success && data) {
        // Check if 2FA is required
        if (data.require_2fa) {
          return { success: true, message, require2FA: true };
        }

        // Normal login success — data IS the user object
        saveUserToStorage(data as unknown as User);
        setUser(data as unknown as User);
        updateAPI();
        return { success: true, message };
      }

      return { success: false, message: message || 'Login failed' };
    } catch (error: any) {
      const message = error.response?.data?.message || 'Login failed';
      return { success: false, message };
    }
  };

  // Register function
  const register = async (params: RegisterParams) => {
    try {
      const { turnstile, ...body } = params;
      const url = turnstile ? `/api/user/register?turnstile=${encodeURIComponent(turnstile)}` : '/api/user/register';
      const res = await API.post<ApiResponse>(url, body);

      const { success, message } = res.data;
      return { success, message: message || (success ? 'Registration successful' : 'Registration failed') };
    } catch (error: any) {
      const message = error.response?.data?.message || 'Registration failed';
      return { success: false, message };
    }
  };

  // Logout function
  const logout = async () => {
    try {
      await API.post('/api/user/logout', null, { skipErrorHandler: true } as any);
    } catch (err) {
      // Ignore logout errors
    } finally {
      removeUserFromStorage();
      setUser(null);
      updateAPI(); // Update API instance to remove user ID
    }
  };

  // Derived state
  const isAuthenticated = user !== null;
  const isAdmin = user?.role === 100; // Role 100 is admin in backend

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isAdmin,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
