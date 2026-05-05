const sentIds = new Set<string>();

export function registerSent(id: string): void {
    sentIds.add(id);
    setTimeout(() => sentIds.delete(id), 30_000);
}

export function wasBotSent(id: string): boolean {
    return sentIds.has(id);
}
