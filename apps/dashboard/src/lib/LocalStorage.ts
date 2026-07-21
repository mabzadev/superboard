class LocalStorage {
  static setAuthenticationToken(access_token: string): void {
    localStorage.setItem("access_token", access_token);
  }

  static getAuthenticationToken(): string | null {
    return localStorage.getItem("access_token");
  }

  static setRefreshToken(refresh_token: string): void {
    localStorage.setItem("refresh_token", refresh_token);
  }

  static getRefreshToken(): string | null {
    return localStorage.getItem("refresh_token");
  }

  static setCurrentUser(user: Record<string, unknown> | object): void {
    if (user) {
      const strValue = JSON.stringify(user);
      localStorage.setItem("current_user", strValue);
    }
  }

  static getCurrentUser(): Record<string, unknown> | null {
    const strValue = localStorage.getItem("current_user");
    if (!strValue) return null;
    const user = JSON.parse(strValue) as Record<string, unknown>;
    return user;
  }

  static logoutUser(): void {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("current_user");
    localStorage.removeItem("login_type");
  }

  static setLoginType = (type: string): void => {
    localStorage.setItem("login_type", type);
  };

  static getLoginType = (): string | null => {
    return localStorage.getItem("login_type");
  };

  static setCraftPreview = (type: string): void => {
    localStorage.setItem("craft-preview-data", type);
  };

  static removeCraftPreview = (): void => {
    localStorage.removeItem("craft-preview-data");
  };

  static getCraftPreview = (): string | null => {
    return localStorage.getItem("craft-preview-data");
  };

  static setDashboardCards = (cards: string[]): void => {
    localStorage.setItem("dashboard_cards", cards.join(","));
  };

  static getDashboardCards = (): string[] | null => {
    const value = localStorage.getItem("dashboard_cards");
    if (!value) return null;
    return value.split(",");
  };

  static setPlatformFilter = (platform: string): void => {
    localStorage.setItem("platforms_filter", platform);
  };

  static getPlatformFilter = (): string | null => {
    return localStorage.getItem("platforms_filter");
  };
}

export default LocalStorage;
