"use client";

import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { refreshToken } from "./RefreshTokenHelper";
import LocalStorage from "./LocalStorage";
import { ApiError, getErrorMessage } from "./ApiError";
import { config } from "./config";

const URL = config.apiUrl;

const DEFAULT_TIMEOUT = 60000;
const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "PUT", "DELETE"]);

export interface RequestOptions {
  onProgress?: ((percentage: number) => void) | null;
  retry?: boolean;
  timeout?: number;
  signal?: AbortSignal;
  maxRetries?: number;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const buildConfig = (
  method: HttpMethod,
  path: string,
  data?: unknown,
  onProgress?: ((percentage: number) => void) | null,
  timeout?: number,
  signal?: AbortSignal
): AxiosRequestConfig => ({
  signal,
  method,
  url: `${URL}${path}`,
  timeout: timeout ?? DEFAULT_TIMEOUT,
  headers: {
    Authorization: `Bearer ${LocalStorage.getAuthenticationToken()}`,
  },
  onUploadProgress(progressEvent) {
    const { loaded, total } = progressEvent;
    if (total != null && onProgress != null) {
      const percentage = Math.floor((loaded * 100) / total);
      onProgress(percentage);
    }
  },
  data,
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeRequest = async (
  config: AxiosRequestConfig,
  retry: boolean,
  maxRetries: number = 0
): Promise<AxiosResponse> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      lastError = error;

      if (axios.isCancel(error)) {
        throw error;
      }

      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        retry
      ) {
        await refreshToken(
          LocalStorage.getRefreshToken() ?? "",
          LocalStorage.getAuthenticationToken() ?? ""
        );

        const latestToken = LocalStorage.getAuthenticationToken();
        const newConfig: AxiosRequestConfig = {
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${latestToken}`,
          },
        };

        return makeRequest(newConfig, false, 0);
      }

      // Retry on transient server errors for idempotent methods
      if (
        axios.isAxiosError(error) &&
        error.response?.status &&
        RETRYABLE_STATUS_CODES.has(error.response.status) &&
        IDEMPOTENT_METHODS.has(config.method?.toUpperCase() ?? "") &&
        attempt < maxRetries
      ) {
        await delay(1000 * Math.pow(2, attempt)); // 1s, 2s
        continue;
      }

      // Convert to ApiError for better caller ergonomics
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 0;
        const message =
          status === 0
            ? "Unable to connect. Check your internet connection."
            : getErrorMessage(status);

        throw new ApiError(message, status, error.code, error.response?.data);
      }

      throw error;
    }
  }

  // Should not reach here, but safety net
  throw lastError;
};

const getDefaultRetries = (method: HttpMethod): number =>
  IDEMPOTENT_METHODS.has(method) ? 2 : 0;

export const GET = async (
  path: string,
  options: RequestOptions = {}
): Promise<AxiosResponse> => {
  const {
    retry = true,
    timeout,
    signal,
    maxRetries = getDefaultRetries("GET"),
  } = options;

  const config = buildConfig(
    "GET",
    path,
    undefined,
    undefined,
    timeout,
    signal
  );
  return makeRequest(config, retry, maxRetries);
};

export const POST = async (
  path: string,
  data?: unknown,
  options: RequestOptions = {}
): Promise<AxiosResponse> => {
  const {
    onProgress = null,
    retry = true,
    timeout,
    signal,
    maxRetries = getDefaultRetries("POST"),
  } = options;

  const config = buildConfig("POST", path, data, onProgress, timeout, signal);
  return makeRequest(config, retry, maxRetries);
};

export const PATCH = async (
  path: string,
  data?: unknown,
  options: RequestOptions = {}
): Promise<AxiosResponse> => {
  const {
    retry = true,
    timeout,
    signal,
    maxRetries = getDefaultRetries("PATCH"),
  } = options;
  const config = buildConfig("PATCH", path, data, undefined, timeout, signal);
  return makeRequest(config, retry, maxRetries);
};

export const PUT = async (
  path: string,
  data?: unknown,
  options: RequestOptions = {}
): Promise<AxiosResponse> => {
  const {
    retry = true,
    timeout,
    signal,
    maxRetries = getDefaultRetries("PUT"),
  } = options;
  const config = buildConfig("PUT", path, data, undefined, timeout, signal);
  return makeRequest(config, retry, maxRetries);
};

export const DELETE = async (
  path: string,
  options: RequestOptions = {}
): Promise<AxiosResponse> => {
  const {
    retry = true,
    timeout,
    signal,
    maxRetries = getDefaultRetries("DELETE"),
  } = options;
  const config = buildConfig(
    "DELETE",
    path,
    undefined,
    undefined,
    timeout,
    signal
  );
  return makeRequest(config, retry, maxRetries);
};
