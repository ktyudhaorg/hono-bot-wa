import fs from "fs";
import path from "path";
import { telegramService } from "./telegram.service";
import { log } from "@/helpers/logger";

export class TelegramMessageService {
    public async send(params: {
        to: string;
        message?: string;
        caption?: string;
        file?: File;
        mediaUrl?: string;
    }): Promise<void> {
        if (!telegramService.isReady) throw new Error("Telegram bot: not ready");

        const { to, message, caption, file, mediaUrl } = params;

        if (file) {
            await this.sendFile(to, file, caption);
        } else if (mediaUrl) {
            await this.sendUrl(to, mediaUrl, caption);
        }

        if (message) {
            await telegramService.bot.sendMessage(to, message);
        }

        log.send(`sent | to: ${to} | hasFile: ${!!file} | hasUrl: ${!!mediaUrl} | hasText: ${!!message}`);
    }

    private async sendFile(to: string, file: File, caption?: string): Promise<void> {
        const tmpDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(tmpDir, `${Date.now()}-${file.name}`);
        fs.writeFileSync(filePath, buffer);

        const stream = fs.createReadStream(filePath);
        const fileOptions = { filename: file.name, contentType: file.type };
        const mimeType = file.type ?? "application/octet-stream";

        try {
            if (mimeType.startsWith("image/")) {
                await telegramService.bot.sendPhoto(to, stream, { caption }, fileOptions);
            } else if (mimeType.startsWith("video/")) {
                await telegramService.bot.sendVideo(to, stream, { caption }, fileOptions);
            } else if (mimeType.startsWith("audio/")) {
                await telegramService.bot.sendAudio(to, stream, { caption }, fileOptions);
            } else {
                await telegramService.bot.sendDocument(to, stream, { caption }, fileOptions);
            }
        } finally {
            fs.unlink(filePath, (err) => {
                if (err) log.error(`failed delete tmp | path: ${filePath}`, err);
                else log.media(`tmp deleted | path: ${filePath}`);
            });
        }
    }

    private async sendUrl(to: string, mediaUrl: string, caption?: string): Promise<void> {
        const mimeType = this.guessMime(mediaUrl);

        if (mimeType.startsWith("image/")) {
            await telegramService.bot.sendPhoto(to, mediaUrl, { caption });
        } else if (mimeType.startsWith("video/")) {
            await telegramService.bot.sendVideo(to, mediaUrl, { caption });
        } else if (mimeType.startsWith("audio/")) {
            await telegramService.bot.sendAudio(to, mediaUrl, { caption });
        } else {
            await telegramService.bot.sendDocument(to, mediaUrl, { caption });
        }
    }

    private guessMime(url: string): string {
        if (/\.(jpg|jpeg|png|webp|gif)$/i.test(url)) return "image/jpeg";
        if (/\.(mp4|mov|avi)$/i.test(url)) return "video/mp4";
        if (/\.(mp3|ogg|wav)$/i.test(url)) return "audio/mp3";
        return "application/octet-stream";
    }
}

export const telegramMessageService = new TelegramMessageService();