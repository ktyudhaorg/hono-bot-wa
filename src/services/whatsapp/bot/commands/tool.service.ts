import { whatsappService } from "@/services/whatsapp";
import { log } from "@/helpers/logger";
import { CommandMap } from "@/context/bot-type.context";

export function registerToolCommands(
    commands: CommandMap,
    schedules: Map<string, NodeJS.Timeout>,
    autoReplies: Map<string, string>,
    templates: Map<string, string>,
    redirectGroupId: string | undefined
): void {
    // Usage:
    //   !schedule add [id] [target] [waktu] [pesan...]
    //   !schedule list
    //   !schedule cancel [id]
    commands.set("schedule", async (message, args) => {
        log.cmd(`schedule | from: ${message.from}`);

        const sub = args[0]?.toLowerCase();

        if (sub === "list") {
            if (schedules.size === 0) {
                await message.reply("📭 Tidak ada jadwal aktif.");
                return;
            }
            const lines = Array.from(schedules.keys()).map((id, i) => `${i + 1}. \`${id}\``);
            await message.reply(`*Jadwal Aktif (${schedules.size})*\n\n${lines.join("\n")}`);
            return;
        }

        if (sub === "cancel") {
            const id = args[1]?.trim();
            if (!id) { await message.reply("Usage: `!schedule cancel [id]`"); return; }

            const timeout = schedules.get(id);
            if (!timeout) { await message.reply(`Jadwal \`${id}\` tidak ditemukan.`); return; }

            clearTimeout(timeout);
            schedules.delete(id);
            await message.reply(`Jadwal \`${id}\` dibatalkan.`);
            log.bot(`schedule cancelled | id: ${id}`);
            return;
        }

        if (sub === "add") {
            if (args.length < 5) {
                await message.reply(
                    "*Usage:*\n\n" +
                    "• Waktu spesifik (HH:MM):\n" +
                    "  `!schedule add myid 6281234@c.us 14:30 Halo!`\n\n" +
                    "• Delay relatif:\n" +
                    "  `!schedule add myid 6281234@c.us 30m Halo!`\n" +
                    "  `!schedule add myid 6281234@c.us 2h Halo!`\n" +
                    "  `!schedule add myid 6281234@c.us 1d Halo!`\n\n" +
                    "• Lihat jadwal: `!schedule list`\n" +
                    "• Batalkan    : `!schedule cancel [id]`"
                );
                return;
            }

            const id = args[1].trim();
            const target = args[2].trim();
            const timeArg = args[3].trim();
            const text = args.slice(4).join(" ");

            if (schedules.has(id)) {
                await message.reply(`ID \`${id}\` sudah ada. Gunakan ID lain atau cancel dulu.`);
                return;
            }

            let delayMs = 0;
            const delayMatch = timeArg.match(/^(\d+)(m|h|d)$/i);

            if (delayMatch) {
                const val = parseInt(delayMatch[1]);
                const unit = delayMatch[2].toLowerCase();
                delayMs = unit === "m" ? val * 60_000 : unit === "h" ? val * 3_600_000 : val * 86_400_000;
            } else if (/^\d{2}:\d{2}$/.test(timeArg)) {
                const [hh, mm] = timeArg.split(":").map(Number);
                const now = new Date();
                const targetDate = new Date(now);
                targetDate.setHours(hh, mm, 0, 0);
                if (targetDate <= now) targetDate.setDate(targetDate.getDate() + 1);
                delayMs = targetDate.getTime() - now.getTime();
            } else {
                await message.reply("Format waktu tidak valid.\nGunakan `HH:MM` atau `30m` / `2h` / `1d`.");
                return;
            }

            const sendAt = new Date(Date.now() + delayMs);
            const label = sendAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

            const timeout = setTimeout(async () => {
                try {
                    await whatsappService.sendMessage(target, text);
                    log.send(`schedule fired | id: ${id} | to: ${target}`);
                    schedules.delete(id);

                    if (redirectGroupId) {
                        await whatsappService.sendMessage(
                            redirectGroupId,
                            `*Pesan Terjadwal Terkirim*\n\n` +
                            `ID    : ${id}\n` +
                            `Ke    : ${target}\n` +
                            `Pesan : ${text.slice(0, 100)}`
                        );
                    }
                } catch (err: any) {
                    log.error(`schedule fire failed | id: ${id} | target: ${target}`, {
                        message: err?.message ?? String(err),
                        stack: err?.stack ?? "-",
                        name: err?.name ?? "-",
                    });
                }
            }, delayMs);

            schedules.set(id, timeout);

            await message.reply(
                `*Jadwal Dibuat*\n\n` +
                `ID    : ${id}\n` +
                `Ke    : ${target}\n` +
                `Waktu : ${label} WIB\n` +
                `Pesan : ${text.slice(0, 80)}`
            );

            log.cmd(`schedule set | id: ${id} | target: ${target} | delay: ${delayMs}ms`);
            return;
        }

        await message.reply(
            "*Sub-command:*\n" +
            "• `!schedule add [id] [target] [waktu] [pesan]`\n" +
            "• `!schedule list`\n" +
            "• `!schedule cancel [id]`"
        );
    });

    // Usage:
    //   !autoreply add [keyword] | [balasan]
    //   !autoreply list
    //   !autoreply delete [keyword]
    //   !autoreply clear
    commands.set("autoreply", async (message, args) => {
        log.cmd(`autoreply | from: ${message.from} | args: [${args.join(", ")}]`);

        const sub = args[0]?.toLowerCase();

        if (sub === "list") {
            if (autoReplies.size === 0) {
                await message.reply("📭 Tidak ada auto reply aktif.");
                return;
            }
            const lines = Array.from(autoReplies.entries()).map(
                ([kw, rep], i) => `*${i + 1}. "${kw}"*\n↩ ${rep.slice(0, 60)}${rep.length > 60 ? "..." : ""}`
            );
            await message.reply(`*Auto Reply (${autoReplies.size})*\n\n${lines.join("\n\n")}`);
            return;
        }

        if (sub === "delete") {
            const keyword = args.slice(1).join(" ").trim();
            if (!keyword) { await message.reply("Usage: `!autoreply delete [keyword]`"); return; }

            if (!autoReplies.has(keyword)) {
                await message.reply(`Keyword "${keyword}" tidak ditemukan.`);
                return;
            }
            autoReplies.delete(keyword);
            await message.reply(`Auto reply "${keyword}" dihapus.`);
            return;
        }

        if (sub === "clear") {
            autoReplies.clear();
            await message.reply("Semua auto reply dihapus.");
            return;
        }

        if (sub === "add") {
            const fullText = args.slice(1).join(" ");
            const sepIdx = fullText.indexOf("|");

            if (sepIdx === -1) {
                await message.reply(
                    "*Usage:*\n`!autoreply add [keyword] | [balasan]`\n\n" +
                    "*Contoh:*\n`!autoreply add halo | Halo juga! Ada yang bisa dibantu?`\n" +
                    "`!autoreply add jam buka | Kami buka Senin-Jumat 09.00-17.00 WIB`"
                );
                return;
            }

            const keyword = fullText.slice(0, sepIdx).trim().toLowerCase();
            const reply = fullText.slice(sepIdx + 1).trim();

            if (!keyword || !reply) {
                await message.reply("Keyword dan balasan tidak boleh kosong.");
                return;
            }

            autoReplies.set(keyword, reply);
            await message.reply(
                `*Auto Reply Ditambahkan*\n\n` +
                `Keyword : "${keyword}"\n` +
                `Balasan : ${reply.slice(0, 100)}`
            );

            log.bot(`autoreply added | keyword: "${keyword}"`);
            return;
        }

        await message.reply(
            "*Sub-command:*\n" +
            "• `!autoreply add [keyword] | [balasan]`\n" +
            "• `!autoreply list`\n" +
            "• `!autoreply delete [keyword]`\n" +
            "• `!autoreply clear`"
        );
    });

    commands.set("template", async (message, args) => {
        log.cmd(`template | from: ${message.from} | args: [${args.join(", ")}]`);

        const sub = args[0]?.toLowerCase();

        if (sub === "list") {
            if (templates.size === 0) {
                await message.reply("Tidak ada template tersimpan.");
                return;
            }
            const lines = Array.from(templates.keys()).map((name, i) => `${i + 1}. \`${name}\``);
            await message.reply(`*Template (${templates.size})*\n\n${lines.join("\n")}`);
            return;
        }

        if (sub === "show") {
            const name = args[1]?.trim();
            if (!name) { await message.reply("Usage: `!template show [nama]`"); return; }

            const content = templates.get(name);
            if (!content) { await message.reply(`Template \`${name}\` tidak ditemukan.`); return; }

            await message.reply(`*Template: ${name}*\n\n${content}`);
            return;
        }

        if (sub === "delete") {
            const name = args[1]?.trim();
            if (!name) { await message.reply("Usage: `!template delete [nama]`"); return; }

            if (!templates.has(name)) {
                await message.reply(`Template \`${name}\` tidak ditemukan.`);
                return;
            }
            templates.delete(name);
            await message.reply(`Template \`${name}\` dihapus.`);
            return;
        }

        if (sub === "send") {
            if (args.length < 3) {
                await message.reply("Usage: `!template send [nama] [target1,target2]`");
                return;
            }

            const name = args[1].trim();
            const content = templates.get(name);

            if (!content) { await message.reply(`Template \`${name}\` tidak ditemukan.`); return; }

            const targets = args[2].split(",").map((t) => t.trim()).filter(Boolean);

            await message.reply(`Mengirim template \`${name}\` ke *${targets.length}* target...`);

            const { success, failed } = await whatsappService.broadcast(targets, content);

            await message.reply(
                `*Template Terkirim*\n\n` +
                `Template : \`${name}\`\n` +
                `Berhasil : *${success.length}*\n` +
                `Gagal    : *${failed.length}*`
            );

            log.cmd(`template send done | name: ${name} | success: ${success.length} | failed: ${failed.length}`);
            return;
        }

        if (sub === "add") {
            const fullText = args.slice(1).join(" ");
            const sepIdx = fullText.indexOf("|");

            if (sepIdx === -1) {
                await message.reply(
                    "*Usage:*\n`!template add [nama] | [isi pesan]`\n\n" +
                    "*Contoh:*\n" +
                    "`!template add promo | 🎉 Promo hari ini diskon 50%! Buruan order!`\n" +
                    "`!template add welcome | Halo! Selamat datang, ada yang bisa kami bantu?`"
                );
                return;
            }

            const name = fullText.slice(0, sepIdx).trim().toLowerCase();
            const content = fullText.slice(sepIdx + 1).trim();

            if (!name || !content) {
                await message.reply("Nama dan isi template tidak boleh kosong.");
                return;
            }

            templates.set(name, content);
            await message.reply(
                `*Template Disimpan*\n\n` +
                `Nama  : \`${name}\`\n` +
                `Isi   : ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}\n\n` +
                `Kirim dengan: \`!template send ${name} [target]\``
            );

            log.bot(`template added | name: "${name}"`);
            return;
        }

        await message.reply(
            "*Sub-command:*\n" +
            "• `!template add [nama] | [isi]`\n" +
            "• `!template list`\n" +
            "• `!template show [nama]`\n" +
            "• `!template send [nama] [target1,target2]`\n" +
            "• `!template delete [nama]`"
        );
    });

    // Usage:
    //   Kirim gambar + caption "!sticker"
    //   Reply gambar/video lalu ketik "!sticker"
    //   !sticker [nama] [author]   → custom metadata
    commands.set("sticker", async (message, args) => {
        log.cmd(`sticker | from: ${message.from}`);

        const stickerName = args[0] ?? "Bot";
        const stickerAuthor = args[1] ?? "WhatsApp Bot";

        let targetMessage = message;

        if (message.hasQuotedMsg) {
            log.bot("sticker: using quoted message");
            targetMessage = await message.getQuotedMessage();
        }

        if (!targetMessage.hasMedia) {
            await message.reply(
                "*Tidak ada gambar/video.*\n\n" +
                "*Cara pakai:*\n" +
                "• Kirim gambar + caption `!sticker`\n" +
                "• Reply gambar/video lalu ketik `!sticker`\n" +
                "• `!sticker [nama] [author]` untuk custom"
            );
            return;
        }

        const type = targetMessage.type;
        const isImage = type === "image";
        const isVideo = type === "video";

        if (!isImage && !isVideo) {
            await message.reply(`Tipe *${type}* tidak didukung. Gunakan gambar atau video (max 3 detik).`);
            return;
        }

        try {
            log.media(`sticker: downloading media | type: ${type}`);
            const media = await targetMessage.downloadMedia();

            if (!media?.data) {
                await message.reply("Gagal download media.");
                return;
            }

            log.media(`sticker: sending as sticker | name: ${stickerName} | author: ${stickerAuthor}`);
            await whatsappService.sendMessage(message.from, media, {
                sendMediaAsSticker: true,
                stickerName,
                stickerAuthor,
                stickerCategories: ["🤖"],
            });

            log.cmd(`sticker sent | to: ${message.from} | type: ${type}`);
        } catch (err) {
            log.error(`sticker failed | from: ${message.from} | error:`, err);
            await message.reply("Gagal buat sticker. Coba lagi.");
        }
    });
}