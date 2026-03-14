import TelegramBot, { Message } from "node-telegram-bot-api";
import { log } from "@/helpers/logger";

export class TelegramService {
    public bot: TelegramBot;
    public isReady: boolean = false;
    private messageHandlers: ((message: Message) => Promise<void>)[] = [];

    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
            polling: false,
        });
        this.initializeEvents();
        log.bot("TelegramService initialized");
    }

    private initializeEvents(): void {
        this.bot.on("polling_error", (err) => log.error("polling error:", err));

        this.bot.on("message", async (message) => {
            log.bot(`message received | from: ${message.chat.id}`);
            for (const handler of this.messageHandlers) {
                try {
                    await handler(message);
                } catch (err) {
                    log.error("handler error:", err);
                }
            }
        });
    }

    public async initialize(): Promise<void> {
        if (this.isReady) {
            log.bot("initialize skipped | already ready");
            return;
        }

        const webhookInfo = await this.bot.getWebHookInfo();
        if (webhookInfo.url) {
            this.isReady = true;
            log.bot(`Webhook already set | url: ${webhookInfo.url}`);
            return;
        }

        await this.bot.stopPolling();
        await this.bot.startPolling();
        this.isReady = true;
        log.bot("Telegram bot ready");
    }

    public async destroy(): Promise<void> {
        await this.bot.stopPolling();
        this.isReady = false;
        log.bot("Telegram bot stopped");
    }

    public async processUpdate(update: any): Promise<void> {
        await this.bot.processUpdate(update);
    }

    public async setWebhook(url: string): Promise<void> {
        await this.bot.stopPolling();
        await this.bot.setWebHook(url);
        this.isReady = true;
        log.bot(`Webhook set | url: ${url}`);
    }

    public async deleteWebhook(): Promise<void> {
        await this.bot.deleteWebHook();
        await this.bot.startPolling();
        this.isReady = true;
        log.bot("Webhook deleted, polling started");
    }

    public onMessage(handler: (message: Message) => Promise<void>): void {
        this.messageHandlers.push(handler);
    }

    public getStatus() {
        return { isReady: this.isReady };
    }
}

export const telegramService = new TelegramService();