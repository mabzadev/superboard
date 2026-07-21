"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";

/* ---------------------------------------------
   Extend window types for Chatwoot 
---------------------------------------------- */
declare global {
  interface Window {
    chatwootSDK?: {
      run: (config: {
        websiteToken: string;
        baseUrl: string;
        hideMessageBubble?: boolean;
        position?: string;
        locale?: string;
        type?: string;
      }) => void;
    };

    chatwootSettings?: Record<string, unknown>;

    $chatwoot?: {
      toggle: (state?: "open" | "close") => void;
      hide: () => void;
      isOpen?: () => boolean;
      on?: (event: string, callback: () => void) => void;
    };
  }
}

/* ---------------------------------------------
   Context Types 
---------------------------------------------- */
interface ChatwootContextValue {
  isChatVisible: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  isChatwootReady: boolean;
}

const ChatwootContext = createContext<ChatwootContextValue | null>(null);

/* ---------------------------------------------
   Provider Props 
---------------------------------------------- */
interface ChatwootProviderProps {
  children: ReactNode;
}

/* ---------------------------------------------
   Provider Component 
---------------------------------------------- */
export const ChatwootProvider = ({ children }: ChatwootProviderProps) => {
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [isChatwootReady, setIsChatwootReady] = useState(false);
  const manuallyOpened = useRef(false);

  /* ---------------------------------------------
     Load Chatwoot Script
  ---------------------------------------------- */
  useEffect(() => {
    const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_URL;
    const TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_TOKEN;
    if (!BASE_URL || !TOKEN) return;

    const checkWidgetState = (): boolean => {
      if (!window.$chatwoot) return false;

      // API method
      if (typeof window.$chatwoot.isOpen === "function") {
        return !!window.$chatwoot.isOpen();
      }

      const selectors = [
        ".woot-widget-holder.woot--expand",
        ".woot-widget-holder[style*='display: block']",
        ".woot-widget-bubble.woot--expand",
        "iframe[data-testid='widgetFrame']:not([style*='display: none'])",
        ".woot--expand",
      ];

      for (const selector of selectors) {
        if (document.querySelector(selector)) return true;
      }

      // Check iframes
      const frames = document.querySelectorAll("iframe[src*='chat']");
      for (const iframe of frames) {
        const style = window.getComputedStyle(iframe);
        if (style.display !== "none" && style.visibility !== "hidden")
          return true;
      }

      return false;
    };

    const setupWidgetMonitoring = () => {
      const observer = new MutationObserver(() => {
        const visible = checkWidgetState();
        setIsChatVisible(visible);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });

      setIsChatVisible(checkWidgetState());

      return () => observer.disconnect();
    };

    const script = document.createElement("script");
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;

    let interval: ReturnType<typeof setInterval> | null = null;

    script.onload = () => {
      window.chatwootSettings = {
        hideMessageBubble: true,
        position: "right",
        locale: "en",
        type: "expanded_bubble",
        darkMode: "auto",
      };

      window.chatwootSDK?.run({
        websiteToken: TOKEN,
        baseUrl: BASE_URL,
        hideMessageBubble: true,
      });

      // Wait for window.$chatwoot to become available
      interval = setInterval(() => {
        if (window.$chatwoot) {
          if (interval) clearInterval(interval);
          interval = null;
          setIsChatwootReady(true);

          setTimeout(() => {
            setupWidgetMonitoring();
          }, 500);
        }
      }, 100);
    };

    document.body.appendChild(script);

    return () => {
      if (interval) clearInterval(interval);
      if (document.body.contains(script)) document.body.removeChild(script);
    };
  }, []);

  /* ---------------------------------------------
     Open / Close / Toggle
  ---------------------------------------------- */
  const openChat = useCallback(() => {
    if (!isChatwootReady || !window.$chatwoot) return;

    manuallyOpened.current = true;
    try {
      window.$chatwoot.toggle("open");
      setIsChatVisible(true);
    } catch (e) {
      console.error("Error opening chat:", e);
    }
  }, [isChatwootReady]);

  const closeChat = useCallback(() => {
    if (!isChatwootReady || !window.$chatwoot) return;

    manuallyOpened.current = false;
    try {
      window.$chatwoot.toggle("close");
      setIsChatVisible(false);
    } catch (e) {
      console.error("Error closing chat:", e);
    }
  }, [isChatwootReady]);

  const toggleChat = useCallback(() => {
    if (isChatVisible) {
      closeChat();
    } else {
      openChat();
    }
  }, [isChatVisible, closeChat, openChat]);

  /* --------------------------------------------- */

  const value = useMemo(
    () => ({
      isChatVisible,
      openChat,
      closeChat,
      toggleChat,
      isChatwootReady,
    }),
    [isChatVisible, openChat, closeChat, toggleChat, isChatwootReady]
  );

  return (
    <ChatwootContext.Provider value={value}>
      {children}
    </ChatwootContext.Provider>
  );
};

/* ---------------------------------------------
   Hook
---------------------------------------------- */
export const useChatwoot = () => {
  const ctx = useContext(ChatwootContext);
  if (!ctx)
    throw new Error("useChatwoot must be used inside <ChatwootProvider>");
  return ctx;
};
