import axios, { AxiosResponse } from "axios";
import LocalStorage from "./LocalStorage";

interface RefreshTokenResponseData {
  access_token?: string;
  token?: string;
  refresh_token: string;
}

// Used to store the in-flight refresh promise
let refreshInProgress: Promise<AxiosResponse<RefreshTokenResponseData>> | null =
  null;

export const refreshToken = (
  refreshtoken: string,
  token: string
): Promise<AxiosResponse<RefreshTokenResponseData>> => {
  if (refreshInProgress) {
    return refreshInProgress;
  }
  refreshInProgress = axios
    .post<RefreshTokenResponseData>("/api/auth/refresh", {
      refresh_token: refreshtoken,
      token,
    })
    .then((response) => {
      const newToken = response.data.access_token ?? response.data.token;
      if (newToken) {
        LocalStorage.setAuthenticationToken(newToken);
      }
      LocalStorage.setRefreshToken(response.data.refresh_token);
      return response;
    })
    .catch((error) => {
      // Session is truly expired — clear tokens and redirect to login
      LocalStorage.logoutUser();
      if (typeof window !== "undefined") {
        window.location.assign(new URL("/login", window.location.origin));
      }
      throw error;
    })
    .finally(() => {
      refreshInProgress = null;
    });
  return refreshInProgress;
};
