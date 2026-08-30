export * from "./support.js";

export default class OpenGrow {
  constructor(
    APIKey: string,
    testEnvironment: boolean,
    linkHandlingCallback: (data: unknown) => void,
    baseURL: string,
  );
  start(success?: (() => void) | null, error?: ((error: unknown) => void) | null): void;
  createLink(
    title: string,
    subtitle: string,
    imageURL: string,
    data: Record<string, unknown>,
    success: (response: unknown) => void,
    error: (error: unknown) => void,
  ): void;
  userIdentifier(): string | null;
  userAttributes(): Record<string, unknown> | null;
  setUserIdentifier(identifier: string): void;
  setUserAttributes(attributes: Record<string, unknown>): void;
  authenticated(): boolean;
  showMessagesList(error?: (error: unknown) => void): void;
  getMessages(
    page: number,
    response: (messages: unknown) => void,
    error: (error: unknown) => void,
  ): void;
  getNumberOfUnreadMessages(
    response: (count: number) => void,
    error: (error: unknown) => void,
  ): void;
  getAllReceivedData(): unknown[];
  markMessageAsRead(
    message: Record<string, unknown>,
    response: (value: unknown) => void,
    error: (error: unknown) => void,
  ): void;

  static readonly SuperBoardSupportClient: typeof import("./support.js").SuperBoardSupportClient;
  static readonly SuperBoardSupportException: typeof import("./support.js").SuperBoardSupportException;
  static readonly SuperBoardSupportRealtime: typeof import("./support.js").SuperBoardSupportRealtime;
  static readonly SuperBoardSupportWidget: typeof import("./support.js").SuperBoardSupportWidget;
}
