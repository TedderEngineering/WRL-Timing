import type { ApiError } from "@shared/types";

const BASE_URL = "/api";

class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    retry = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // Don't set Content-Type for FormData (multipart)
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: "include", // send cookies (refresh token)
    });

    if (!response.ok) {
      // Attempt auto-refresh on 401, but only once and not for auth endpoints
      if (
        response.status === 401 &&
        retry &&
        !path.startsWith("/auth/refresh") &&
        !path.startsWith("/auth/login")
      ) {
        try {
          await this.attemptRefresh();
          // Retry the original request with new token
          return this.request<T>(path, options, false);
        } catch {
          // Refresh failed — propagate the 401
        }
      }

      const error: ApiError = await response.json().catch(() => ({
        error: response.statusText || "Request failed",
        code: "UNKNOWN",
      }));

      throw new ApiClientError(response.status, error.error, error.code);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Attempt a single token refresh. Deduplicates concurrent refresh attempts.
   */
  private async attemptRefresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });

        if (!response.ok) {
          this.accessToken = null;
          throw new Error("Refresh failed");
        }

        const data = await response.json();
        this.accessToken = data.accessToken;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  postForm<T>(path: string, formData: FormData) {
    return this.request<T>(path, {
      method: "POST",
      body: formData,
    });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const api = new ApiClient();
