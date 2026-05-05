import { Client, Message } from "whatsapp-web.js";
import * as qrcode from "qrcode-terminal";
import { log } from "@/helpers/logger";
import { WhatsAppState } from "./state.service";
import { wasBotSent } from "./bot-sent-registry";

type MessageHandler = (message: Message) => Promise<void>;

export class WhatsAppEventHandler {
    private processedMessages: Set<string> = new Set();

    constructor(
        private readonly messageHandlers: MessageHandler[],
        private readonly state: WhatsAppState,
        private readonly onDisconnected: () => Promise<void>,
    ) { }

    public register(client: Client): void {
        client.on("qr", (qr: string) => {
            log.bot("QR Code received, scan dengan WhatsApp Anda:");
            qrcode.generate(qr, { small: true });
        });

        client.on("ready", () => {
            this.state.isReady = true;
            this.state.isInitializing = false;
            this.state.botNumber = client.info.wid.user;
            this.state.botName = client.info.pushname ?? null;
            log.bot(`client ready | nomor: ${this.state.botNumber} | nama: ${this.state.botName}`);
        });

        client.on("authenticated", () => {
            log.bot("authenticated successfully");
        });

        client.on("auth_failure", (msg: string) => {
            log.error(`authentication failed | reason: ${msg}`);
            this.state.isReady = false;
            this.state.isInitializing = false;
        });

        client.on("disconnected", async (reason: string) => {
            if (this.state.isInitializing) return;

            this.state.isReady = false;
            this.state.isInitializing = true;
            log.warn(`client disconnected | reason: ${reason}`);

            await this.onDisconnected();
        });

        client.on("message", async (message: Message) => {
            await this.handleMessage(message);
        });

        // Capture outgoing messages sent from the phone (not triggered by "message" event)
        client.on("message_create", async (message: Message) => {
            if (!message.fromMe) return;
            if (wasBotSent(message.id._serialized)) return;
            await this.handleMessage(message);
        });
    }

    private async handleMessage(message: Message): Promise<void> {
        const msgId = message.id._serialized;
        const from = message.from;
        const type = message.type;

        if (this.processedMessages.has(msgId)) {
            log.bot(`skip duplicate | id: ${msgId}`);
            return;
        }

        this.processedMessages.add(msgId);
        setTimeout(() => this.processedMessages.delete(msgId), 60_000);

        log.bot(`message received | from: ${from} | type: ${type} | id: ${msgId}`);

        for (const handler of this.messageHandlers) {
            try {
                await handler(message);
            } catch (err) {
                log.error(`handler error | from: ${from} | id: ${msgId} | error:`, err);
            }
        }
    }
}