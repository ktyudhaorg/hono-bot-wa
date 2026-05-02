import * as crypto from "crypto";

const PUBLIC_KEY = process.env.HMAC_PUBLIC_KEY || "";
const SECRET_KEY = process.env.HMAC_SECRET_KEY || "";
const TOLERANCE = 300; // 5 menit

export class HmacService {
    /**
     * Generate signature
     */
    static sign(data: string): string {
        return crypto
            .createHmac("sha256", SECRET_KEY)
            .update(data)
            .digest("base64");
    }

    /**
     * Build payload (HARUS sama dengan PHP)
     */
    static buildPayload(timestamp: string): string {
        return PUBLIC_KEY + timestamp;
    }

    /**
     * Generate headers (untuk request keluar)
     */
    static generateHeaders(): Record<string, string> {
        const timestamp = String(Math.floor(Date.now() / 1000));

        return {
            "X-Key": PUBLIC_KEY,
            "X-Timestamp": timestamp,
            "X-Token": this.sign(this.buildPayload(timestamp)),
        };
    }

    /**
     * Validate request masuk
     */
    static validate({
        clientKey,
        timestamp,
        token,
    }: {
        clientKey?: string;
        timestamp?: string;
        token?: string;
    }): boolean {

        if (!clientKey || !timestamp || !token) return false;

        if (clientKey !== PUBLIC_KEY) return false;

        const parsed = parseInt(timestamp, 10);
        if (isNaN(parsed)) return false;

        const now = Math.floor(Date.now() / 1000);

        // toleransi dua arah (lebih robust)
        if (Math.abs(now - parsed) > TOLERANCE) return false;

        const expected = this.sign(this.buildPayload(String(timestamp)));

        // prevent crash
        if (token.length !== expected.length) return false;

        try {
            return crypto.timingSafeEqual(
                Buffer.from(token),
                Buffer.from(expected)
            );
        } catch {
            return false;
        }
    }
}