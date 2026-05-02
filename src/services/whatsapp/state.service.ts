export interface WhatsAppState {
    isReady: boolean;
    isInitializing: boolean;
    botNumber: string | null;
}

export function createInitialState(): WhatsAppState {
    return {
        isReady: false,
        isInitializing: false,
        botNumber: null,
    };
}