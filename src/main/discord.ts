import { Client } from "@xhayper/discord-rpc";

const DISCORD_CLIENT_ID = "1284550000000000000"; // InfinityPlay default client ID

let client: Client | null = null;
let isConnected = false;

export async function initDiscordRpc(): Promise<void> {
  try {
    client = new Client({ clientId: DISCORD_CLIENT_ID });
    
    client.on("ready", () => {
      isConnected = true;
    });

    client.on("disconnected", () => {
      isConnected = false;
    });

    await client.login().catch(() => {
      isConnected = false;
    });
  } catch {
    isConnected = false;
  }
}

export async function setDiscordActivity(params: {
  details: string; // Movie/Show Title
  state?: string; // Season / Episode / Status
  startTimestamp?: number;
  endTimestamp?: number;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
}): Promise<void> {
  if (!client || !isConnected) return;
  try {
    await client.user?.setActivity({
      details: params.details,
      state: params.state || "Watching on InfinityPlay",
      startTimestamp: params.startTimestamp ? new Date(params.startTimestamp) : undefined,
      endTimestamp: params.endTimestamp ? new Date(params.endTimestamp) : undefined,
      largeImageKey: params.largeImageKey || "logo",
      largeImageText: params.largeImageText || "InfinityPlay",
      smallImageKey: params.smallImageKey || "play",
      smallImageText: params.smallImageText || "Playing",
      instance: false,
    });
  } catch {
    // Graceful error ignore
  }
}

export async function clearDiscordActivity(): Promise<void> {
  if (!client || !isConnected) return;
  try {
    await client.user?.clearActivity();
  } catch {
    // Graceful error ignore
  }
}
