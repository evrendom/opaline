import { createContext, type ReactNode } from "react";

export const ContextMapHead = createContext<ReactNode>(null);

export const ContextAreaHeight = createContext<number | null>(null);

export const ContextPreview = createContext(false);

export const ContextToggleSlot = createContext<HTMLElement | null>(null);
