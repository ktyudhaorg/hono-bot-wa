import { whatsappService } from "@/services/whatsapp";
import { safeString } from "@/helpers/general";
import { log } from "@/helpers/logger";
import { CommandMap } from "@/context/bot-type.context";

export function registerSendCommands(
    commands: CommandMap,
    replyMap: Map<string, string>,
    redirectGroupId: string | undefined
): void {
    commands.set("send", async (message, args) => {
        log.cmd(`send | from: ${message.from} | args: [${args.join(", ")}]`);

        if (args.length < 2) {
            await message.reply(
                "*Usage:*\n!send [nomor/groupId] [pesan]\n\n" +
                "*Contoh:*\n!send 6281234567890 Halo!\n" +
                "!send 1234567890@g.us Halo group!"
            );
            return;
        }

        const target = args[0];
        const text = args.slice(1).join(" ");
        const to = target.endsWith("@g.us") ? target : `${target.replace(/\D/g, "")}@c.us`;

        const contact = await message.getContact();
        const senderName = contact.pushname || contact.name || contact.number || message.from;
        const senderNumber = contact.number || contact.id.user || message.from;

        try {
            log.send(`send command | from: ${senderName} (+${senderNumber}) | to: ${to} | length: ${text.length} chars`);
            await whatsappService.sendMessage(to, text);
            log.send(`send command success | to: ${to}`);

            if (redirectGroupId) {
                const monitorMessage = await whatsappService.sendMessage(
                    redirectGroupId,
                    safeString(
                        `*Pesan Terkirim*\n\n` +
                        `*Dari*: ${senderName}\n` +
                        `*Nomor*: +${senderNumber}\n\n` +
                        `*Ke*: ${target}\n\n` +
                        `*Pesan*:\n${text}`
                    )
                );
                replyMap.set(monitorMessage.id._serialized, to);
                log.bot(`replyMap set (send monitor) | msgId: ${monitorMessage.id._serialized} → ${to}`);
            }

            await message.reply(`Pesan terkirim ke *${target}*`);
        } catch (err) {
            log.error(`send command failed | to: ${target} | error:`, err);
            await message.reply(`Gagal kirim ke *${target}*`);
        }
    });

    // Usage:
    // !broadcast all | Pesan                          → semua (kontak + group)
    // !broadcast all-contacts | Pesan                 → semua kontak
    // !broadcast all-groups | Pesan                   → semua group
    // !broadcast 628xxx,628yyy,groupId@g.us | Pesan   → target spesifik (mix)
    commands.set("broadcast", async (message, args) => {
        log.cmd(`broadcast | from: ${message.from}`);

        const fullText = args.join(" ");
        const separatorIndex = fullText.indexOf("|");

        if (separatorIndex === -1) {
            await message.reply(
                "*Usage:*\n\n" +
                "• Semua (kontak + group):\n  `!broadcast all | Pesan`\n\n" +
                "• Semua kontak:\n  `!broadcast all-contacts | Pesan`\n\n" +
                "• Semua group:\n  `!broadcast all-groups | Pesan`\n\n" +
                "• Target spesifik (mix nomor & group):\n  `!broadcast 628xxx,628yyy,groupId@g.us | Pesan`"
            );
            return;
        }

        const targetsRaw = fullText.slice(0, separatorIndex).trim();
        const broadcastMsg = fullText.slice(separatorIndex + 1).trim();

        if (!targetsRaw || !broadcastMsg) {
            await message.reply("Target dan pesan tidak boleh kosong.");
            return;
        }

        const targets = targetsRaw.split(",").map((t) => t.trim()).filter(Boolean);

        const isAll = targets.includes("all");
        const isAllContacts = targets.includes("all-contacts");
        const isAllGroups = targets.includes("all-groups");

        const targetLabel = isAll
            ? "Semua kontak & group"
            : isAllContacts
                ? "Semua kontak"
                : isAllGroups
                    ? "Semua group"
                    : `${targets.length} target`;

        await message.reply(
            `*Broadcast Dimulai*\n\n` +
            `Target : *${targetLabel}*\n` +
            `Pesan  : "${broadcastMsg.slice(0, 60)}${broadcastMsg.length > 60 ? "..." : ""}"`
        );

        const { success, failed } = await whatsappService.broadcast(targets, broadcastMsg);

        await message.reply(
            `*Broadcast Selesai*\n\n` +
            `Berhasil: *${success.length}*\n` +
            `Gagal   : *${failed.length}*\n\n` +
            (failed.length > 0
                ? `*Gagal ke:*\n${failed.map((id) => `• ${id}`).join("\n")}`
                : "🎉 Semua berhasil!")
        );

        log.cmd(`broadcast done | success: ${success.length} | failed: ${failed.length}`);
    });
}