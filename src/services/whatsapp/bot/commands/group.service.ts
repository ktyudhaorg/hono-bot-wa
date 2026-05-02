import { log } from "@/helpers/logger";
import { ensureBotIsAdmin, toContactId } from "@/helpers/whatsapp";
import { CommandMap } from "@/context/bot-type.context";

export function registerGroupCommands(commands: CommandMap): void {
    commands.set("add", async (message, args) => {
        log.cmd(`add | from: ${message.from} | args: [${args.join(", ")}]`);

        if (args.length < 2) {
            await message.reply(
                "*Usage:*\n`!add [groupId] [nomor1,nomor2]`\n\n" +
                "*Contoh:*\n`!add 1234567890@g.us 6281234,6285678`"
            );
            return;
        }

        const groupId = args[0].trim();
        const numbers = args[1].split(",").map((n) => toContactId(n.trim())).filter(Boolean);

        if (!groupId.endsWith("@g.us")) {
            await message.reply("Group ID harus diakhiri `@g.us`.");
            return;
        }

        if (numbers.length === 0) {
            await message.reply("Tidak ada nomor valid.");
            return;
        }

        try {
            const { chat } = await ensureBotIsAdmin(groupId);

            log.bot(`add: adding ${numbers.length} member(s) to ${groupId}`);
            const result = await chat.addParticipants(numbers);

            const success: string[] = [];
            const failed: string[] = [];

            for (const [id, res] of Object.entries(result as any)) {
                const code = (res as any)?.code ?? (res as any)?.status;
                if (code === 200 || code === "200") success.push(id);
                else failed.push(`${id} (code: ${code})`);
            }

            await message.reply(
                `*Tambah Member Selesai*\n\n` +
                `Group   : ${chat.name}\n` +
                `Berhasil: *${success.length}*\n` +
                `Gagal   : *${failed.length}*\n\n` +
                (failed.length > 0 ? `*Gagal:*\n${failed.map((f) => `• ${f}`).join("\n")}` : "🎉 Semua berhasil!")
            );
        } catch (err: any) {
            log.error(`add failed | group: ${groupId} | error:`, err);
            await message.reply(`Gagal tambah member.\n_${err.message}_`);
        }

        log.cmd(`add done | group: ${groupId}`);
    });

    commands.set("kick", async (message, args) => {
        log.cmd(`kick | from: ${message.from} | args: [${args.join(", ")}]`);

        if (args.length < 2) {
            await message.reply(
                "*Usage:*\n`!kick [groupId] [nomor1,nomor2]`\n\n" +
                "*Contoh:*\n`!kick 1234567890@g.us 6281234,6285678`"
            );
            return;
        }

        const groupId = args[0].trim();
        const numbers = args[1].split(",").map((n) => toContactId(n.trim())).filter(Boolean);

        if (!groupId.endsWith("@g.us")) {
            await message.reply("Group ID harus diakhiri `@g.us`.");
            return;
        }

        try {
            const { chat, botId } = await ensureBotIsAdmin(groupId);

            const filtered = numbers.filter((n) => n !== botId);
            if (filtered.length === 0) {
                await message.reply("Tidak bisa kick bot itu sendiri.");
                return;
            }

            const adminIds = chat.participants
                ?.filter((p: any) => p.isAdmin || p.isSuperAdmin)
                .map((p: any) => p.id._serialized) ?? [];

            const toKick = filtered.filter((n) => !adminIds.includes(n));
            const skippedAdmin = filtered.filter((n) => adminIds.includes(n));

            if (toKick.length === 0) {
                await message.reply("Semua target adalah admin, tidak bisa di-kick.");
                return;
            }

            log.bot(`kick: removing ${toKick.length} member(s) from ${groupId}`);
            await chat.removeParticipants(toKick);

            await message.reply(
                `*Kick Member Selesai*\n\n` +
                `Group    : ${chat.name}\n` +
                `Di-kick  : *${toKick.length}*\n` +
                (skippedAdmin.length > 0 ? `Skip admin: ${skippedAdmin.map((n) => `• ${n}`).join("\n")}` : "")
            );
        } catch (err: any) {
            log.error(`kick failed | group: ${groupId} | error:`, err);
            await message.reply(`Gagal kick member.\n_${err.message}_`);
        }

        log.cmd(`kick done | group: ${groupId}`);
    });

    commands.set("promote", async (message, args) => {
        log.cmd(`promote | from: ${message.from} | args: [${args.join(", ")}]`);

        if (args.length < 2) {
            await message.reply(
                "*Usage:*\n`!promote [groupId] [nomor1,nomor2]`\n\n" +
                "*Contoh:*\n`!promote 1234567890@g.us 6281234`"
            );
            return;
        }

        const groupId = args[0].trim();
        const numbers = args[1].split(",").map((n) => toContactId(n.trim())).filter(Boolean);

        if (!groupId.endsWith("@g.us")) {
            await message.reply("Group ID harus diakhiri `@g.us`.");
            return;
        }

        try {
            const { chat } = await ensureBotIsAdmin(groupId);

            const memberIds = chat.participants?.map((p: any) => p.id._serialized) ?? [];
            const valid = numbers.filter((n) => memberIds.includes(n));
            const invalid = numbers.filter((n) => !memberIds.includes(n));

            if (valid.length === 0) {
                await message.reply("Tidak ada target yang merupakan member group.");
                return;
            }

            log.bot(`promote: promoting ${valid.length} member(s) in ${groupId}`);
            await chat.promoteParticipants(valid);

            await message.reply(
                `*Promote Admin Selesai*\n\n` +
                `Group     : ${chat.name}\n` +
                `Dipromote : *${valid.length}*\n` +
                (invalid.length > 0
                    ? `Bukan member:\n${invalid.map((n) => `• ${n}`).join("\n")}`
                    : "Semua berhasil!")
            );
        } catch (err: any) {
            log.error(`promote failed | group: ${groupId} | error:`, err);
            await message.reply(`Gagal promote member.\n_${err.message}_`);
        }

        log.cmd(`promote done | group: ${groupId}`);
    });

    commands.set("demote", async (message, args) => {
        log.cmd(`demote | from: ${message.from} | args: [${args.join(", ")}]`);

        if (args.length < 2) {
            await message.reply(
                "*Usage:*\n`!demote [groupId] [nomor1,nomor2]`\n\n" +
                "*Contoh:*\n`!demote 1234567890@g.us 6281234`"
            );
            return;
        }

        const groupId = args[0].trim();
        const numbers = args[1].split(",").map((n) => toContactId(n.trim())).filter(Boolean);

        if (!groupId.endsWith("@g.us")) {
            await message.reply("Group ID harus diakhiri `@g.us`.");
            return;
        }

        try {
            const { chat, botId } = await ensureBotIsAdmin(groupId);

            const filtered = numbers.filter((n) => n !== botId);
            if (filtered.length === 0) {
                await message.reply("Tidak bisa demote bot itu sendiri.");
                return;
            }

            const adminIds = chat.participants
                ?.filter((p: any) => p.isAdmin || p.isSuperAdmin)
                .map((p: any) => p.id._serialized) ?? [];

            const todemote = filtered.filter((n) => adminIds.includes(n));
            const notAdmin = filtered.filter((n) => !adminIds.includes(n));
            const superAdmins = filtered.filter((n) =>
                chat.participants?.find((p: any) => p.id._serialized === n)?.isSuperAdmin
            );

            if (todemote.length === 0) {
                await message.reply("Tidak ada target yang merupakan admin.");
                return;
            }

            if (superAdmins.length > 0) {
                await message.reply(
                    `⚠ *Tidak bisa demote super admin:*\n` +
                    `${superAdmins.map((n) => `• ${n}`).join("\n")}`
                );
                return;
            }

            log.bot(`demote: demoting ${todemote.length} admin(s) in ${groupId}`);
            await chat.demoteParticipants(todemote);

            await message.reply(
                `*Demote Admin Selesai*\n\n` +
                `Group    : ${chat.name}\n` +
                `Di-demote: *${todemote.length}*\n` +
                (notAdmin.length > 0
                    ? `Bukan admin:\n${notAdmin.map((n) => `• ${n}`).join("\n")}`
                    : "Semua berhasil!")
            );
        } catch (err: any) {
            log.error(`demote failed | group: ${groupId} | error:`, err);
            await message.reply(`Gagal demote admin.\n_${err.message}_`);
        }

        log.cmd(`demote done | group: ${groupId}`);
    });
}