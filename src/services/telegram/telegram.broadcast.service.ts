import { telegramMessageService } from "./telegram.message.service";
import { telegramService } from "./telegram.service";
import { log } from "@/helpers/logger";

export class TelegramBroadcastService {
    public async broadcast(
        targets: string[],
        message: string,
        options?: {
            delayMs?: number;
            caption?: string;
            file?: File;
            mediaUrl?: string;
        }
    ): Promise<{ success: string[]; failed: string[] }> {
        if (!telegramService.isReady) throw new Error("Telegram bot: not ready");

        const delay = options?.delayMs ?? 1000;
        const success: string[] = [];
        const failed: string[] = [];

        log.send(`broadcast start | total targets: ${targets.length}`);

        for (const to of targets) {
            try {
                await telegramMessageService.send({
                    to,
                    message,
                    caption: options?.caption,
                    file: options?.file,
                    mediaUrl: options?.mediaUrl,
                });
                success.push(to);
                log.send(`broadcast ok | to: ${to}`);
            } catch (err) {
                failed.push(to);
                log.error(`broadcast failed | to: ${to}`, err);
            }

            await new Promise(res => setTimeout(res, delay));
        }

        log.send(`broadcast done | success: ${success.length} | failed: ${failed.length}`);
        return { success, failed };
    }
}

export const telegramBroadcastService = new TelegramBroadcastService();