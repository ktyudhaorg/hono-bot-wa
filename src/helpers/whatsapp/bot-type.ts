import { whatsappService } from "@/services/whatsapp";
import { safeString } from "@/helpers/general";
import { log } from "@/helpers/logger";

export function buildSenderHeader(senderName: string, senderNumber: string, type: string): string {
    return safeString(
        `*Pesan Masuk*\n\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}\n\n` +
        `*Tipe*: ${type.toUpperCase()}`
    );
}

export async function sendHeaderMessage(
    redirectGroupId: string,
    senderName: string,
    senderNumber: string,
    type: string
): Promise<void> {
    log.send(`sendHeaderMessage | type: ${type} | to: ${redirectGroupId}`);
    await whatsappService.sendMessage(redirectGroupId, buildSenderHeader(senderName, senderNumber, type));
}

export async function ensureBotIsAdmin(groupId: string): Promise<{ chat: any; botId: string }> {
    const chat = await whatsappService.getChatById(groupId) as any;
    if (!chat.isGroup) throw new Error("Bukan group chat.");

    const botId = `${whatsappService.botNumber}@c.us`;
    const botPart = chat.participants?.find((p: any) => p.id._serialized === botId);
    if (!botPart) throw new Error("Bot bukan anggota group ini.");
    if (!botPart.isAdmin) throw new Error("Bot bukan admin di group ini.");

    return { chat, botId };
}

export function toContactId(raw: string): string {
    if (raw.endsWith("@c.us")) return raw;
    return `${raw.replace(/\D/g, "")}@c.us`;
}
