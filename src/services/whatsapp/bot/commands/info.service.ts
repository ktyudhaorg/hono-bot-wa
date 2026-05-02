import { Message } from "whatsapp-web.js";
import { whatsappService } from "@/services/whatsapp";
import { log } from "@/helpers/logger";
import { CommandMap } from "@/context/bot-type.context";

export function registerInfoCommands(commands: CommandMap): void {
    commands.set("ping", async (message) => {
        log.cmd(`ping | from: ${message.from}`);
        await message.reply("pong 🏓");
    });

    commands.set("help", async (message) => {
        log.cmd(`help | from: ${message.from}`);
        const helpText = Array.from(commands.keys())
            .map((cmd) => `• !${cmd}`)
            .join("\n");
        await message.reply(`WhatsApp Bot Command\n${helpText}`);
    });

    commands.set("whoami", async (message) => {
        log.cmd(`whoami | from: ${message.from}`);
        const contact = await message.getContact();
        log.bot(`whoami | number: ${contact.number} | pushname: ${contact.pushname}`);
        await message.reply(
            `*Debug Info*\n\n` +
            `from: ${message.from}\n` +
            `number: ${contact.number}\n` +
            `pushname: ${contact.pushname}\n` +
            `name: ${contact.name}\n` +
            `id.user: ${contact.id.user}\n` +
            `id._serialized: ${contact.id._serialized}`
        );
    });

    commands.set("status", async (message) => {
        log.cmd(`status | from: ${message.from}`);

        const status = whatsappService.getStatus();
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const memUsage = process.memoryUsage();
        const mbUsed = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        const mbTotal = (memUsage.heapTotal / 1024 / 1024).toFixed(1);

        await message.reply(
            `*Status Bot*\n\n` +
            `Ready       : ${status.isReady ? "Ya" : "Tidak"}\n` +
            `Authenticated: ${status.isAuthenticated ? "Ya" : "Tidak"}\n` +
            `Nomor Bot   : ${whatsappService.botNumber ?? "-"}\n\n` +
            `Uptime      : ${hours}j ${minutes}m ${seconds}d\n` +
            `Memory      : ${mbUsed} / ${mbTotal} MB\n` +
            `Node.js     : ${process.version}`
        );

        log.cmd(`status done | isReady: ${status.isReady}`);
    });

    commands.set("location", async (message) => {
        log.cmd(`location | from: ${message.from}`);
        let location = message.location;

        if (!location && message.hasQuotedMsg) {
            log.bot("location: checking quoted message...");
            const quoted = await message.getQuotedMessage();
            location = quoted.location;
        }

        if (!location) {
            log.warn(`location: not found | from: ${message.from}`);
            await message.reply("Kirim lokasi atau *reply pesan lokasi* lalu ketik `!location`.");
            return;
        }

        const { latitude, longitude, accuracy, speed, degrees, address } = location as any;
        log.bot(`location found | lat: ${latitude} | lng: ${longitude} | from: ${message.from}`);

        await message.reply(
            `*Location Received*\n\n` +
            `Lat: ${latitude}\nLng: ${longitude}\n` +
            (accuracy ? `Accuracy: ${accuracy} m\n` : "") +
            (speed ? `Speed: ${speed}\n` : "") +
            (degrees ? `Direction: ${degrees}\n` : "") +
            (address ? `\nAddress: ${address}` : "")
        );
    });

    commands.set("get-chat", async (message) => {
        log.cmd(`get-chat | from: ${message.from}`);
        const chats = await whatsappService.getChats();
        log.bot(`get-chat | total chats: ${chats.length}`);

        const filtered = chats.filter((c) => c.id?._serialized).slice(0, 10);
        log.bot(`get-chat | filtered: ${filtered.length} chats`);

        const chatLines = await Promise.all(
            filtered.map(async (c, i) => {
                const isGroup = c.id._serialized.endsWith("@g.us");

                if (isGroup) {
                    const groupChat = c as any;
                    log.bot(`get-chat | group: ${c.name} | id: ${c.id._serialized}`);
                    return [
                        `*${i + 1}. [Group] ${c.name}*`,
                        `id      : ${c.id._serialized}`,
                        `members : ${groupChat.participants?.length || "-"}`,
                    ].join("\n");
                }

                try {
                    const contact = await Promise.race([
                        c.getContact(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
                    ]) as any;

                    const name = contact.pushname || contact.name || contact.number || c.id.user;
                    const number = contact.number || contact.id.user;

                    log.bot(`get-chat | personal: ${name} | number: ${number}`);
                    return [
                        `*${i + 1}. ${name}*`,
                        `number  : +${number}`,
                        `id      : ${c.id._serialized}`,
                    ].join("\n");
                } catch (err) {
                    log.warn(`get-chat | getContact timeout/error | id: ${c.id._serialized} | error: ${err}`);
                    return [
                        `*${i + 1}. ${c.id.user}*`,
                        `number  : +${c.id.user}`,
                        `id      : ${c.id._serialized}`,
                    ].join("\n");
                }
            })
        );

        await message.reply(`*Daftar Chat*\n\n${chatLines.join("\n\n")}`);
        log.cmd(`get-chat done | returned: ${filtered.length} chats`);
    });

    commands.set("list-group", async (message) => {
        log.cmd(`list-group | from: ${message.from}`);

        const groups = await whatsappService.getGroups();

        if (groups.length === 0) {
            await message.reply("Tidak ada group ditemukan.");
            return;
        }

        const lines = groups.map((g, i) =>
            `*${i + 1}. ${g.name}*\n` +
            `id      : ${g.id}\n` +
            `members : ${g.participants}`
        );

        const chunkSize = 10;
        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);
            await message.reply(
                `*Daftar Group (${i + 1}-${Math.min(i + chunkSize, lines.length)} dari ${groups.length})*\n\n` +
                chunk.join("\n\n")
            );
        }

        log.cmd(`list-group done | total: ${groups.length}`);
    });

    // Usage:
    //   !info              → info pengirim
    //   !info 6281234      → info kontak by nomor
    //   !info 1234@g.us    → info group by ID
    commands.set("info", async (message, args) => {
        log.cmd(`info | from: ${message.from} | args: [${args.join(", ")}]`);

        const target = args[0]?.trim();

        // ── Info Group ─────────────────────────────────────────────────
        if (target?.endsWith("@g.us") || (!target && message.from.endsWith("@g.us"))) {
            const groupId = target ?? message.from;

            try {
                const chat = await whatsappService.getChatById(groupId) as any;
                await message.reply(
                    `*Info Group*\n\n` +
                    `Nama      : ${chat.name}\n` +
                    `ID        : ${chat.id._serialized}\n` +
                    `Members   : ${chat.participants?.length ?? "-"}\n` +
                    `Deskripsi : ${chat.description || "-"}\n` +
                    `Only Admin: ${chat.groupMetadata?.announce ? "Ya" : "Tidak"}\n` +
                    `Dibuat    : ${chat.groupMetadata?.creation
                        ? new Date(chat.groupMetadata.creation * 1000).toLocaleString("id-ID")
                        : "-"
                    }`
                );
            } catch (err) {
                log.error(`info group failed | id: ${groupId} | error:`, err);
                await message.reply(`Gagal ambil info group: ${groupId}`);
            }
            return;
        }

        // ── Info Kontak ────────────────────────────────────────────────
        try {
            let contact: any;

            if (target) {
                const number = target.replace(/\D/g, "");
                const chatId = `${number}@c.us`;

                log.bot(`info: resolving contact | chatId: ${chatId}`);

                try {
                    const chat = await whatsappService.getChatById(chatId);
                    contact = await (chat as any).getContact();
                    log.bot(`info: contact resolved via getChatById | name: ${contact?.pushname}`);
                } catch {
                    log.warn(`info: getChatById failed, trying getContactById | chatId: ${chatId}`);
                    contact = await whatsappService.getContactById(chatId);
                }
            } else {
                contact = await message.getContact();
            }

            if (!contact) {
                await message.reply(`Kontak tidak ditemukan.`);
                return;
            }

            log.bot(`info: contact found | number: ${contact.number} | pushname: ${contact.pushname}`);

            let isRegistered: any = "-";
            try {
                if (typeof contact.isWAContact === "function") {
                    isRegistered = await contact.isWAContact();
                } else if (typeof contact.isWAContact === "boolean") {
                    isRegistered = contact.isWAContact;
                }
            } catch {
                isRegistered = "-";
            }

            await message.reply(
                `*Info Kontak*\n\n` +
                `Nama      : ${contact.pushname || contact.name || "-"}\n` +
                `Nomor     : +${contact.number || target}\n` +
                `ID        : ${contact.id?._serialized ?? `${target}@c.us`}\n` +
                `Di WA     : ${isRegistered === true ? "Ya" : isRegistered === false ? "Tidak" : "-"}\n` +
                `Bisnis    : ${contact.isBusiness ? "Ya" : "Tidak"}\n` +
                `Diblokir  : ${contact.isBlocked ? "Ya" : "Tidak"}`
            );
        } catch (err) {
            log.error(`info contact failed | target: ${target} | error:`, err);

            if (target) {
                const number = target.replace(/\D/g, "");
                await message.reply(
                    `*Info Kontak* _(terbatas)_\n\n` +
                    `Nomor : +${number}\n` +
                    `ID    : ${number}@c.us\n\n` +
                    `Data lengkap tidak tersedia.\n` +
                    `Kontak mungkin belum pernah chat dengan bot._`
                );
            } else {
                await message.reply(`Gagal ambil info kontak.`);
            }
        }

        log.cmd(`info done | target: ${target ?? message.from}`);
    });
}