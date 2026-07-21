"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";

import {
  changePasswordAPICall,
  createAccountAPICall,
  currentUserAPICall,
  editUserAPICall,
  fetchLoginWithSSOEndpointAPICall,
  enable2FAAPICall,
  getOTPQrcodeAPICall,
  logoutAPICall,
  removeUserAPICall,
  resetPasswordAPICall,
  signInAPICall,
  acceptInviteAPICall,
} from "../api/auth/userService";

import LocalStorage from "../lib/LocalStorage";
import { trackEvent, identify, reset, EVENTS } from "@/analytics";

import type { AxiosResponse } from "axios";
import type { User, EditUserPayload } from "@/types";

export interface UserContextType {
  user: User | null;
  userRef: React.RefObject<User | null>;
  currentUser: () => User | null;
  handleSetUser: (user: User) => void;
  isHydrated: boolean;
  createUser: (
    email: string,
    password: string,
    name: string
  ) => Promise<AxiosResponse>;
  loginUser: (
    email: string,
    password: string,
    otpCode: string
  ) => Promise<AxiosResponse>;
  logoutUser: (token: string | null) => Promise<AxiosResponse>;
  removeAccount: (email: string) => Promise<AxiosResponse>;
  resetPassword: (email: string) => Promise<AxiosResponse>;
  changePassword: (token: string, password: string) => Promise<AxiosResponse>;
  fetchCurrentUser: () => Promise<AxiosResponse>;
  acceptInvitation: (
    inviteToken: string,
    name: string,
    password: string
  ) => Promise<AxiosResponse>;
  enable2FA: (enable: boolean, otpCode: string) => Promise<AxiosResponse>;
  getOTPQrcode: () => Promise<AxiosResponse>;
  editUser: (data: EditUserPayload) => Promise<AxiosResponse>;
  getSSOAuthenticationLink: (sso: string) => Promise<AxiosResponse>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

interface Props {
  children: ReactNode;
}

const UserContextProvider = ({ children }: Props) => {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const currentUser = useCallback(
    () => LocalStorage.getCurrentUser() as User | null,
    []
  );

  const handleSetUser = useCallback((user: User) => {
    setUser(user);
    LocalStorage.setCurrentUser(user);
  }, []);

  const handleUserResponse = useCallback((response: AxiosResponse) => {
    userRef.current = response.data.user;
    setUser(userRef.current);
    LocalStorage.setCurrentUser(response.data.user as Record<string, unknown>);
  }, []);

  const handleLoggedInUserResponse = useCallback(
    (response: AxiosResponse) => {
      LocalStorage.setAuthenticationToken(response.data.access_token);
      LocalStorage.setRefreshToken(response.data.refresh_token);
      handleUserResponse(response);
    },
    [handleUserResponse]
  );

  const loginUser = useCallback(
    async (
      email: string,
      password: string,
      otpCode: string
    ): Promise<AxiosResponse> => {
      const response = await signInAPICall(email, password, otpCode);
      if (response.data.requires_otp) {
        return response;
      }
      handleLoggedInUserResponse(response);
      const user = response.data.user;
      identify(user.id, { email: user.email, name: user.name });
      trackEvent(EVENTS.LOGIN);
      return response;
    },
    [handleLoggedInUserResponse]
  );

  const logoutUser = useCallback(
    async (token: string | null): Promise<AxiosResponse> => {
      const response = await logoutAPICall(token ?? "");
      // Track logout and reset analytics
      trackEvent(EVENTS.LOGOUT);
      reset();
      LocalStorage.logoutUser();
      userRef.current = null;
      setUser(null);
      return response;
    },
    []
  );

  const removeAccount = useCallback(
    async (email: string): Promise<AxiosResponse> => {
      const response = await removeUserAPICall(email);
      LocalStorage.logoutUser();
      return response;
    },
    []
  );

  const fetchCurrentUser = useCallback(async (): Promise<AxiosResponse> => {
    const response = await currentUserAPICall();
    handleUserResponse(response);
    return response;
  }, [handleUserResponse]);

  const createUser = useCallback(
    async (
      email: string,
      password: string,
      name: string
    ): Promise<AxiosResponse> => {
      const response = await createAccountAPICall(email, password, name);
      handleLoggedInUserResponse(response);
      // Track signup event
      const user = response.data.user;
      identify(user.id, { email: user.email, name: user.name });
      trackEvent(EVENTS.SIGN_UP);
      return response;
    },
    [handleLoggedInUserResponse]
  );

  const editUser = useCallback(
    async (data: EditUserPayload): Promise<AxiosResponse> => {
      const response = await editUserAPICall(data);
      handleUserResponse(response);
      return response;
    },
    [handleUserResponse]
  );

  const acceptInvitation = useCallback(
    async (
      inviteToken: string,
      name: string,
      password: string
    ): Promise<AxiosResponse> => {
      const response = await acceptInviteAPICall(inviteToken, name, password);
      handleLoggedInUserResponse(response);
      return response;
    },
    [handleLoggedInUserResponse]
  );

  const resetPassword = useCallback(
    async (email: string): Promise<AxiosResponse> => {
      const response = await resetPasswordAPICall(email);
      return response;
    },
    []
  );

  const changePassword = useCallback(
    async (token: string, password: string): Promise<AxiosResponse> => {
      const response = await changePasswordAPICall(token, password);
      return response;
    },
    []
  );

  const enable2FA = useCallback(
    async (enable: boolean, otpCode: string): Promise<AxiosResponse> => {
      const response = await enable2FAAPICall(enable, otpCode);
      return response;
    },
    []
  );

  const getOTPQrcode = useCallback(async (): Promise<AxiosResponse> => {
    const response = await getOTPQrcodeAPICall();
    return response;
  }, []);

  const getSSOAuthenticationLink = useCallback(
    async (sso: string): Promise<AxiosResponse> => {
      const response = await fetchLoginWithSSOEndpointAPICall(sso);
      return response;
    },
    []
  );

  useEffect(() => {
    const existingUser = LocalStorage.getCurrentUser() as User | null;
    if (existingUser) {
      userRef.current = existingUser;
      setUser(existingUser);
    }

    // Now hydration is done, whether or not user existed
    setIsHydrated(true);
  }, []);

  const value = useMemo(
    () => ({
      user,
      userRef,
      createUser,
      loginUser,
      logoutUser,
      removeAccount,
      resetPassword,
      changePassword,
      fetchCurrentUser,
      currentUser,
      handleSetUser,
      acceptInvitation,
      enable2FA,
      getOTPQrcode,
      editUser,
      getSSOAuthenticationLink,
      isHydrated,
    }),
    [
      user,
      userRef,
      createUser,
      loginUser,
      logoutUser,
      removeAccount,
      resetPassword,
      changePassword,
      fetchCurrentUser,
      currentUser,
      handleSetUser,
      acceptInvitation,
      enable2FA,
      getOTPQrcode,
      editUser,
      getSSOAuthenticationLink,
      isHydrated,
    ]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUserContext = () => {
  const ctx = useContext(UserContext);
  if (!ctx)
    throw new Error("useUserContext must be used within UserContextProvider");
  return ctx;
};

export default UserContextProvider;
