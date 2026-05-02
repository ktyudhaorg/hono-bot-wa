import { Message } from "whatsapp-web.js";

export interface BotContext {
    whatsappRedirectGroupId: string | undefined;
    replyMap: Map<string, string>;
    liveLocationMap: Map<string, { lastUpdate: number; groupMessageId: string }>;
    schedules: Map<string, NodeJS.Timeout>;
    autoReplies: Map<string, string>;
    templates: Map<string, string>;
    maxSizeVideo: number;
    prefix: string;
}

export type CommandHandler = (message: Message, args: string[]) => Promise<void>;
export type CommandMap = Map<string, CommandHandler>;