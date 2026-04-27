import { whatsappService } from "@/services/whatsapp.service";
import { WhatsAppBotService } from "@/services/whatsappBot.service";
import { log } from "@/helpers/logger";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = Number(process.env.WHATSAPP_STARTUP_DELAY_MS) || 8_000;

async function attemptInitialize(): Promise<void> {
  await whatsappService.initialize();
  new WhatsAppBotService();
  log.bot("bot is now active");
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  log.bot(
    `retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${attempt}/${MAX_RETRIES})`,
  );
  await whatsappService.reset();
  await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
}

export default async function whatsappInitialize(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.bot(`initialize attempt ${attempt}/${MAX_RETRIES}`);
      await attemptInitialize();
      return;
    } catch (err) {
      log.error(`attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) await waitBeforeRetry(attempt);
    }
  }

  log.error("semua attempt gagal, bot tidak aktif");
}
