import { Client, GroupChat, Message } from "whatsapp-web.js";
import { log } from "@/helpers/logger";
import { createWhatsAppClient } from "./client.service";
import { WhatsAppEventHandler } from "./event-handler.service";
import { WhatsAppSender } from "./sender.service";
import { WhatsAppState, createInitialState } from "./state.service";

export class WhatsAppService {
    private client: Client;
    private state: WhatsAppState;
    private messageHandlers: ((message: Message) => Promise<void>)[] = [];
    private eventHandler: WhatsAppEventHandler;

    public readonly sender: WhatsAppSender;
    public get botNumber(): string | null { return this.state.botNumber; }

    constructor() {
        this.state = createInitialState();
        this.client = createWhatsAppClient();

        this.eventHandler = new WhatsAppEventHandler(
            this.messageHandlers,
            this.state,
            () => this.reinitialize(),
        );

        this.sender = new WhatsAppSender(
            () => this.client,
            (target, isGroup) => this.toWhatsAppId(target, isGroup),
            () => this.checkReady(),
        );

        this.eventHandler.register(this.client);
        log.bot("WhatsAppService initialized");
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public async initialize(): Promise<void> {
        if (this.state.isInitializing || this.state.isReady) {
            log.bot(
                `initialize skipped | isInitializing: ${this.state.isInitializing} | isReady: ${this.state.isReady}`,
            );
            return;
        }

        this.state.isInitializing = true;
        log.bot("initializing client...");

        try {
            await this.client.initialize();
        } catch (error) {
            this.state.isInitializing = false;
            log.error("initialize failed:", error);
            throw error;
        }
    }

    public async reset(): Promise<void> {
        try {
            await this.client.destroy();
        } catch (err) {
            log.warn("client destroy failed, continuing reset:", (err as Error).message);
        }

        this.state.isReady = false;
        this.state.isInitializing = false;
        this.client = createWhatsAppClient();
        this.eventHandler.register(this.client);
    }

    public async logout(): Promise<void> {
        log.bot("logging out...");
        await this.client.logout();
        this.state.isReady = false;
        log.bot("logged out successfully");
    }

    public async destroy(): Promise<void> {
        log.bot("destroying client...");
        await this.client.destroy();
        this.state.isReady = false;
        log.bot("client destroyed");
    }

    private async reinitialize(): Promise<void> {
        try {
            await this.client.destroy();
            log.bot("client destroyed, reinitializing...");
        } catch (err) {
            log.warn("error saat destroy client:", err);
        }

        this.client = createWhatsAppClient();
        this.eventHandler.register(this.client);

        try {
            await this.client.initialize();
            log.bot("client reinitialized successfully");
        } catch (err) {
            log.error("gagal reinitialize client:", err);
            this.state.isInitializing = false;
        }
    }

    // ─── Message handler registration ─────────────────────────────────────────

    public onMessage(handler: (message: Message) => Promise<void>): void {
        this.messageHandlers.push(handler);
        log.bot(`handler registered | total handlers: ${this.messageHandlers.length}`);
    }

    // ─── Send (proxy ke WhatsAppSender) ───────────────────────────────────────

    public async sendMessage(to: string, content: any, options?: any): Promise<any> {
        return this.sender.sendMessage(to, content, options);
    }

    public async sendChatMessage(to: string, message: string): Promise<void> {
        return this.sender.sendChatMessage(to, message);
    }

    public async sendMessageGlobal(to: string, message: string): Promise<void> {
        return this.sender.sendMessageGlobal(to, message);
    }

    public async sendMediaGlobal(to: string, filePath: string, caption?: string): Promise<void> {
        return this.sender.sendMediaGlobal(to, filePath, caption);
    }

    public async sendMedia(to: string, mediaUrl: string, caption?: string): Promise<void> {
        return this.sender.sendMedia(to, mediaUrl, caption);
    }

    public async sendMediaWithUrl(to: string, mediaUrl: string, caption?: string): Promise<void> {
        return this.sender.sendMediaWithUrl(to, mediaUrl, caption);
    }

    public async sendMessageToGroup(groupId: string, message: string): Promise<void> {
        return this.sender.sendMessageToGroup(groupId, message);
    }

    public async sendMediaToGroup(groupId: string, mediaUrl: string, caption?: string): Promise<void> {
        return this.sender.sendMediaToGroup(groupId, mediaUrl, caption);
    }

    public async broadcast(
        targets: string[],
        message: string,
        options?: { delayMs?: number; caption?: string; filePath?: string },
    ): Promise<{ success: string[]; failed: string[] }> {
        return this.sender.broadcast(targets, message, options);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public async getChats(): Promise<any[]> {
        this.checkReady();
        log.bot("fetching chats...");
        const chats = await this.client.getChats();
        log.bot(`chats fetched | total: ${chats.length}`);
        return chats;
    }

    public async getGroups(): Promise<any[]> {
        this.checkReady();
        log.bot("fetching groups...");
        const chats = await this.client.getChats();
        const groups = chats
            .filter((chat) => chat.isGroup)
            .map((chat) => {
                const groupChat = chat as GroupChat;
                return {
                    id: groupChat.id._serialized,
                    name: groupChat.name,
                    participants: groupChat.participants.length,
                };
            });
        log.bot(`groups fetched | total: ${groups.length}`);
        return groups;
    }

    public async getChatMessages(to: string, limit: number = 10) {
        this.checkReady();
        log.bot(`fetching chat messages | to: ${to} | limit: ${limit}`);
        const chatId = await this.toWhatsAppId(to);
        const chat = await this.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit });
        log.bot(`chat messages fetched | total: ${messages.length}`);
        return messages.map((msg) => ({
            id: msg.id._serialized,
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp,
            isFromMe: msg.fromMe,
            type: msg.type,
        }));
    }

    public async getGroupMessages(groupId: string, limit: number = 10) {
        this.checkReady();
        log.bot(`fetching group messages | group: ${groupId} | limit: ${limit}`);
        const chatId = await this.toWhatsAppId(groupId, true);
        const chat = await this.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit });
        log.bot(`group messages fetched | total: ${messages.length}`);
        return messages.map((msg) => ({
            id: msg.id._serialized,
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp,
            isFromMe: msg.fromMe,
            type: msg.type,
        }));
    }

    public async getChatById(chatId: string): Promise<any> {
        this.checkReady();
        return this.client.getChatById(chatId);
    }

    public async getContactById(contactId: string): Promise<any> {
        this.checkReady();
        return this.client.getContactById(contactId);
    }

    public getStatus(): { isReady: boolean; isAuthenticated: boolean } {
        const status = {
            isReady: this.state.isReady,
            isAuthenticated: this.client.info !== undefined,
        };
        log.bot(`status check | isReady: ${status.isReady} | isAuthenticated: ${status.isAuthenticated}`);
        return status;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private checkReady(): void {
        if (!this.state.isReady) throw new Error("WhatsApp client: not ready");
    }

    private async toWhatsAppId(target: string, isGroup = false): Promise<string> {
        if (target.endsWith("@g.us")) return target;
        if (isGroup) return `${target}@g.us`;

        const raw = target.replace(/@c\.us$/, "").replace(/@lid$/, "");

        try {
            const numberId = await this.client.getNumberId(raw);
            if (numberId) return numberId._serialized;
        } catch {
            log.warn(`getNumberId failed | number: ${raw}, fallback manual`);
        }

        if (target.endsWith("@lid")) {
            log.warn(`@lid fallback | sending directly | to: ${target}`);
            return target;
        }

        return `${raw}@c.us`;
    }

}

export const whatsappService = new WhatsAppService();