import { telegramService } from "@/services/telegram/telegram.service";
import { log } from "@/helpers/logger";

export default async function telegramInitialize() {
    await telegramService.initialize();
    log.bot("Telegram bot is now active");
}