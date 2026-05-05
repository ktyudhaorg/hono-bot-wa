import { Message } from "whatsapp-web.js";
import { whatsappService } from "@/services/whatsapp";
import { safeBody } from "@/helpers/general";
import { log } from "@/helpers/logger";

import { BotContext, CommandMap } from "@/context/bot-type.context";
import { handleAutoReply } from "@/helpers/whatsapp";
import { handleForwardToGroup, handleForwardOutgoingToGroup } from "@/services/whatsapp/bot/forward-message.service";
import { handleGroupReply } from "@/services/whatsapp/bot/reply-from-group.service";
import {
    registerInfoCommands,
    registerSendCommands,
    registerGroupCommands,
    registerToolCommands
} from "@/services/whatsapp/bot/commands";

export class WhatsAppBotService {
    private ctx: BotContext = {
        whatsappRedirectGroupId: process.env.WHATSAPP_REDIRECT_GROUP_ID,
        replyMap: new Map(),
        liveLocationMap: new Map(),
        schedules: new Map(),
        autoReplies: new Map(),
        templates: new Map(),
        maxSizeVideo: 16,
        prefix: "!",
    };

    private commands: CommandMap = new Map();

    constructor() {
        this.registerCommands();
        whatsappService.onMessage((message) => this.handleMessage(message));
        log.bot("WhatsAppBotService initialized");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SINGLE ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────────
    private async handleMessage(message: Message): Promise<void> {
        const from = message.from;
        const type = message.type;
        const preview = message.body?.slice(0, 50) ?? "-";

        log.bot(`message received | from: ${from} | type: ${type} | body: "${preview}"`);

        try {
            const body = safeBody(message.body, "");

            if (from === this.ctx.whatsappRedirectGroupId) {
                log.bot(`routing to handleGroupReply | from: ${from}`);
                await handleGroupReply(message, this.ctx.replyMap);
                return;
            }

            if (message.fromMe && !message.isStatus) {
                if (body.startsWith(this.ctx.prefix)) {
                    log.cmd(`routing to handleCommand (fromMe) | body: "${body.slice(0, 30)}"`);
                    await this.handleCommand(message, body);
                }

                if (this.ctx.whatsappRedirectGroupId) {
                    log.bot(`routing to handleForwardOutgoingToGroup | to: ${message.to}`);
                    await handleForwardOutgoingToGroup(message, this.ctx.whatsappRedirectGroupId, this.ctx.replyMap);
                }
                return;
            }

            if (body.startsWith(this.ctx.prefix)) {
                log.cmd(`routing to handleCommand | body: "${body.slice(0, 30)}"`);
                await this.handleCommand(message, body);
                return;
            }

            if (this.ctx.autoReplies.size > 0) {
                const replied = await handleAutoReply(message, this.ctx.autoReplies);
                if (replied) return;
            }

            if (!from.endsWith("@g.us") && !message.isStatus) {
                if (!this.ctx.whatsappRedirectGroupId) {
                    log.error("WHATSAPP_REDIRECT_GROUP_ID tidak ada di .env!");
                    return;
                }
                log.bot(`routing to handleForwardToGroup | from: ${from}`);
                await handleForwardToGroup(message, this.ctx.whatsappRedirectGroupId, this.ctx.replyMap);
                return;
            }

            log.bot(`message skipped | from: ${from} | isGroup: ${from.endsWith("@g.us")} | isStatus: ${message.isStatus}`);
        } catch (err) {
            log.error(`handleMessage error | from: ${from} | type: ${type} | error:`, err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Command dispatcher
    // ─────────────────────────────────────────────────────────────────────────
    private async handleCommand(message: Message, body: string): Promise<void> {
        const [cmd, ...args] = body.slice(this.ctx.prefix.length).split(" ");
        const commandName = cmd.toLowerCase();
        const commandHandler = this.commands.get(commandName);

        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || contact.number || message.from;
        const senderNumber = contact.number || contact.id.user || message.from;

        if (commandHandler) {
            log.cmd(`executing command | cmd: ${commandName} | args: [${args.join(", ")}] | from: ${message.from}`);
            try {
                await commandHandler(message, args);
                log.cmd(`command done | cmd: ${commandName}`);

                if (this.ctx.whatsappRedirectGroupId) {
                    await whatsappService.sendMessage(
                        this.ctx.whatsappRedirectGroupId,
                        `*Command Dijalankan*\n\n` +
                        `Dari   : ${senderName}\n` +
                        `Nomor  : +${senderNumber}\n` +
                        `Command: \`${body.slice(0, 100)}\`\n` +
                        `Status : Berhasil`
                    );
                }
            } catch (err) {
                log.error(`command error | cmd: ${commandName} | from: ${message.from} | error:`, err);
                await message.reply("Terjadi kesalahan saat menjalankan perintah.");

                if (this.ctx.whatsappRedirectGroupId) {
                    await whatsappService.sendMessage(
                        this.ctx.whatsappRedirectGroupId,
                        `*Command Gagal*\n\n` +
                        `Dari   : ${senderName}\n` +
                        `Nomor  : +${senderNumber}\n` +
                        `Command: \`${body.slice(0, 100)}\`\n` +
                        `Error  : ${String(err).slice(0, 200)}`
                    );
                }
            }
        } else {
            log.warn(`unknown command | cmd: ${commandName} | from: ${message.from}`);
            await message.reply("Perintah tidak dikenal.\nKetik *!help* untuk daftar perintah.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Register all commands via feature modules
    // ─────────────────────────────────────────────────────────────────────────
    private registerCommands(): void {
        registerInfoCommands(this.commands);
        registerSendCommands(this.commands, this.ctx.replyMap, this.ctx.whatsappRedirectGroupId);
        registerGroupCommands(this.commands);
        registerToolCommands(
            this.commands,
            this.ctx.schedules,
            this.ctx.autoReplies,
            this.ctx.templates,
            this.ctx.whatsappRedirectGroupId
        );

        log.bot(`commands registered | total: ${this.commands.size} | list: [${Array.from(this.commands.keys()).join(", ")}]`);
    }
}