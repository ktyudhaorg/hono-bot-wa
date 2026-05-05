export interface WhatsAppState {
    isReady: boolean;
    isInitializing: boolean;
    botNumber: string | null;
    botName: string | null;
}

export function createInitialState(): WhatsAppState {
    return {
        isReady: false,
        isInitializing: false,
        botNumber: null,
        botName: null,
    };
}