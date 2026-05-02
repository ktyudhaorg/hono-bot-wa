import { Client, LocalAuth } from "whatsapp-web.js";
import fs from "fs";
import { log } from "@/helpers/logger";

const CHROMIUM_LOCK_FILES = [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
    "lockfile",
];

export function cleanChromiumLock(): void {
    const base = "/app/.wwebjs_auth/session";

    for (const file of CHROMIUM_LOCK_FILES) {
        try {
            fs.rmSync(`${base}/${file}`, { force: true });
        } catch { }
    }
}

export function createWhatsAppClient(): Client {
    cleanChromiumLock();
    log.bot("creating new WhatsApp client...");

    return new Client({
        authStrategy: new LocalAuth({
            dataPath: "/app/.wwebjs_auth",
        }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--disable-extensions",
                "--single-process",
            ],
        },
    });
}