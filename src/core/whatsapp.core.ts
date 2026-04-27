import { whatsappService } from "@/services/whatsapp.service";
import { WhatsAppBotService } from "@/services/whatsappBot.service";
import { log } from "@/helpers/logger";

export default async function whatsappInitialize() {
  // Wait for system to fully ready after unexpected restart (e.g. power failure)
  await new Promise((res) =>
    setTimeout(res, Number(process.env.WHATSAPP_STARTUP_DELAY_MS) || 8000),
  );

  await whatsappService.initialize();

  new WhatsAppBotService();
  log.bot("bot is now active");
}
