class SessionStorage {
  static setDateFilter = (date: string): void => {
    sessionStorage.setItem("date_filter", date);
  };

  static getDateFilter = (): string | null => {
    return sessionStorage.getItem("date_filter");
  };
}

export default SessionStorage;
