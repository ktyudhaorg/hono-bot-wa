import { Client, MessageMedia } from "whatsapp-web.js";
import fs from "fs";
import { log } from "@/helpers/logger";
import { registerSent } from "./bot-sent-registry";

type GetClient = () => Client;
type ToWhatsAppId = (target: string, isGroup?: boolean) => Promise<string>;
type CheckReady = () => void;

export class WhatsAppSender {
    constructor(
        private readonly getClient: GetClient,
        private readonly toWhatsAppId: ToWhatsAppId,
        private readonly checkReady: CheckReady,
    ) { }

    private async _send(chatId: string, content: any, options?: any): Promise<any> {
        const sent = await this.getClient().sendMessage(chatId, content, options);
        if (sent?.id?._serialized) registerSent(sent.id._serialized);
        return sent;
    }

    // ─── Generic send (with @lid / @g.us fallback) ────────────────────────────

    public async sendMessage(to: string, content: any, options?: any): Promise<any> {
        this.checkReady();
        const client = this.getClient();

        try {
            const rawNumber = to.replace(/@c\.us$/, "").replace(/@lid$/, "");
            const numberId = await client.getNumberId(rawNumber);

            if (!numberId) throw new Error(`Nomor ${to} tidak terdaftar di WhatsApp`);

            const resolvedId = numberId._serialized;
            log.send(`sendMessage | to: ${resolvedId}`);
            return this._send(resolvedId, content, options);
        } catch (err: any) {
            if (to.endsWith("@g.us")) {
                return this._send(to, content, options);
            }

            if (to.endsWith("@lid")) {
                log.warn(`getNumberId failed for @lid, sending directly | to: ${to}`);
                return this._send(to, content, options);
            }

            throw err;
        }
    }

    // ─── Chat ─────────────────────────────────────────────────────────────────

    public async sendChatMessage(to: string, message: string): Promise<void> {
        this.checkReady();

        try {
            const chatId = await this.toWhatsAppId(to);
            await this._send(chatId, message);
            log.send(`chat message sent | to: ${chatId} | length: ${message.length} chars`);
        } catch (error) {
            log.error(`sendChatMessage failed | to: ${to} | error:`, error);
            throw error;
        }
    }

    // ─── Global ───────────────────────────────────────────────────────────────

    public async sendMessageGlobal(to: string, message: string): Promise<void> {
        this.checkReady();

        try {
            const chatId = await this.toWhatsAppId(to);
            await this._send(chatId, message);
            log.send(`global message sent | to: ${to} | length: ${message.length} chars`);
        } catch (error) {
            log.error(`sendMessageGlobal failed | to: ${to} | error:`, error);
            throw error;
        }
    }

    public async sendMediaGlobal(to: string, filePath: string, caption?: string): Promise<void> {
        this.checkReady();

        try {
            const chatId = await this.toWhatsAppId(to);
            const media = MessageMedia.fromFilePath(filePath);
            await this._send(chatId, media, { caption });
            log.send(`global media sent | to: ${chatId} | file: ${filePath} | caption: ${caption ?? "-"}`);

            fs.unlink(filePath, (err) => {
                if (err) log.error(`failed delete tmp file | path: ${filePath} | error:`, err);
                else log.media(`tmp file deleted | path: ${filePath}`);
            });
        } catch (error) {
            log.error(`sendMediaGlobal failed | to: ${to} | file: ${filePath} | error:`, error);
            throw error;
        }
    }

    // ─── Media ────────────────────────────────────────────────────────────────

    public async sendMedia(to: string, mediaUrl: string, caption?: string): Promise<void> {
        this.checkReady();

        log.media(`fetching media | url: ${mediaUrl}`);
        const chatId = await this.toWhatsAppId(to);
        const media = await MessageMedia.fromUrl(mediaUrl);
        await this._send(chatId, media, { caption });
        log.send(`media sent | to: ${chatId} | caption: ${caption ?? "-"}`);
    }

    public async sendMediaWithUrl(to: string, mediaUrl: string, caption?: string): Promise<void> {
        this.checkReady();

        try {
            log.media(`fetching media from url | url: ${mediaUrl}`);
            const chatId = await this.toWhatsAppId(to);
            const media = await MessageMedia.fromUrl(mediaUrl);
            await this._send(chatId, media, { caption });
            log.send(`media with url sent | to: ${chatId} | caption: ${caption ?? "-"}`);
        } catch (error) {
            log.error(`sendMediaWithUrl failed | to: ${to} | url: ${mediaUrl} | error:`, error);
            throw error;
        }
    }

    // ─── Group ────────────────────────────────────────────────────────────────

    public async sendMessageToGroup(groupId: string, message: string): Promise<void> {
        this.checkReady();

        try {
            const chatId = await this.toWhatsAppId(groupId, true);
            await this._send(chatId, message);
            log.send(`message sent to group | group: ${groupId} | length: ${message.length} chars`);
        } catch (error) {
            log.error(`sendMessageToGroup failed | group: ${groupId} | error:`, error);
            throw error;
        }
    }

    public async sendMediaToGroup(groupId: string, mediaUrl: string, caption?: string): Promise<void> {
        this.checkReady();

        try {
            log.media(`fetching media for group | group: ${groupId} | url: ${mediaUrl}`);
            const chatId = await this.toWhatsAppId(groupId, true);
            const media = await MessageMedia.fromUrl(mediaUrl);
            await this._send(chatId, media, { caption });
            log.send(`media sent to group | group: ${groupId} | caption: ${caption ?? "-"}`);
        } catch (error) {
            log.error(`sendMediaToGroup failed | group: ${groupId} | url: ${mediaUrl} | error:`, error);
            throw error;
        }
    }

    // ─── Broadcast ────────────────────────────────────────────────────────────

    public async broadcast(
        targets: string[],
        message: string,
        options?: { delayMs?: number; caption?: string; filePath?: string },
    ): Promise<{ success: string[]; failed: string[] }> {
        this.checkReady();

        const delay = options?.delayMs ?? 3000;
        const success: string[] = [];
        const failed: string[] = [];

        const resolvedTargets = await this.resolveTargets(targets);
        const uniqueTargets = [...new Set(resolvedTargets)];
        log.send(`broadcast start | total targets: ${uniqueTargets.length}`);

        const media = options?.filePath
            ? MessageMedia.fromFilePath(options.filePath)
            : null;

        for (const chatId of uniqueTargets) {
            try {
                if (media) {
                    await this._send(chatId, media, { caption: options?.caption ?? message });
                } else {
                    await this._send(chatId, message);
                }

                log.send(`broadcast ok | to: ${chatId}`);
                success.push(chatId);
            } catch (err) {
                log.error(`broadcast failed | to: ${chatId} | error:`, err);
                failed.push(chatId);
            }

            await new Promise((res) => setTimeout(res, delay + Math.random() * 1000));
        }

        log.send(`broadcast done | success: ${success.length} | failed: ${failed.length}`);
        return { success, failed };
    }

    private async resolveTargets(targets: string[]): Promise<string[]> {
        const resolved: string[] = [];
        const KEYWORDS = ["all", "all-contacts", "all-groups"] as const;

        const needContacts = targets.includes("all") || targets.includes("all-contacts");
        const needGroups = targets.includes("all") || targets.includes("all-groups");

        if (needContacts || needGroups) {
            const chats = await this.getClient().getChats();

            if (needContacts) {
                resolved.push(
                    ...chats
                        .filter((c) => !c.isGroup && c.id._serialized.endsWith("@c.us"))
                        .map((c) => c.id._serialized),
                );
            }

            if (needGroups) {
                resolved.push(
                    ...chats
                        .filter((c) => c.isGroup)
                        .map((c) => c.id._serialized),
                );
            }
        }

        const manualTargets = targets.filter((t) => !(KEYWORDS as readonly string[]).includes(t));

        for (const t of manualTargets) {
            if (t.endsWith("@c.us") || t.endsWith("@g.us")) {
                resolved.push(t);
            } else {
                resolved.push(`${t.replace(/\D/g, "")}@c.us`);
            }
        }

        return resolved;
    }
}