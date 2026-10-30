import { afterEach, describe, expect, it, vi } from "vitest";
import { WebBluetoothTransport } from "./transports";

/** A fake BLE printer; `busy` = how many connects to refuse (another app holds it). */
function fakePrinter() {
  const log: string[] = [];
  const state = { connected: false, busy: 0 };
  const ch = {
    properties: { writeWithoutResponse: true, write: true },
    writeValueWithoutResponse: async () => {
      if (!state.connected) throw new Error("GATT Server is disconnected.");
      log.push("write");
    },
    writeValueWithResponse: async () => log.push("writeR"),
  };
  const gatt = {
    get connected() {
      return state.connected;
    },
    connect: async () => {
      if (state.busy > 0) {
        state.busy--;
        log.push("refused");
        throw new Error("NetworkError: Connection failed");
      }
      state.connected = true;
      log.push("connect");
      return gatt;
    },
    disconnect: () => {
      if (state.connected) log.push("disconnect");
      state.connected = false;
    },
    getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }],
  };
  const device = { id: "p1", name: "Posiflow", gatt, addEventListener: () => undefined };
  vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
  vi.stubGlobal("window", { isSecureContext: true });
  return { log, state };
}

const payload = { bytes: new Uint8Array(100), text: "", bigLines: [], widthChars: 32 };

describe("Bluetooth printing shared with other apps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects only to print and lets go right after", async () => {
    vi.useFakeTimers();
    const p = fakePrinter();
    const t = new WebBluetoothTransport({ chunkSize: 20, rememberedDeviceId: "p1", onDeviceId: () => undefined, share: () => true });
    const run = t.print(payload);
    await vi.runAllTimersAsync();
    await run;
    expect(p.log.filter((x) => x !== "write")).toEqual(["connect", "disconnect"]);
    expect(p.log.filter((x) => x === "write")).toHaveLength(5);
    expect(t.isReady()).toBe(false);
  });

  it("stays connected when sharing is off", async () => {
    vi.useFakeTimers();
    const p = fakePrinter();
    const t = new WebBluetoothTransport({ chunkSize: 20, rememberedDeviceId: "p1", onDeviceId: () => undefined, share: () => false });
    const run = t.print(payload);
    await vi.runAllTimersAsync();
    await run;
    expect(p.log).not.toContain("disconnect");
    expect(t.isReady()).toBe(true);
  });

  it("reconnects after the printer dropped the link (sleep, or another app took it)", async () => {
    vi.useFakeTimers();
    const p = fakePrinter();
    const t = new WebBluetoothTransport({ chunkSize: 20, rememberedDeviceId: "p1", onDeviceId: () => undefined, share: () => false });
    let run = t.print(payload);
    await vi.runAllTimersAsync();
    await run;
    p.state.connected = false; // printer went to sleep
    run = t.print(payload);
    await vi.runAllTimersAsync();
    await run;
    expect(p.log.filter((x) => x === "connect")).toHaveLength(2);
  });

  it("reports a printer held by another app clearly", async () => {
    const p = fakePrinter();
    p.state.busy = 1;
    const t = new WebBluetoothTransport({ chunkSize: 20, rememberedDeviceId: "p1", onDeviceId: () => undefined, share: () => true });
    await expect(t.print(payload)).rejects.toThrow(/NetworkError/);
    expect(t.isReady()).toBe(false);
  });
});
