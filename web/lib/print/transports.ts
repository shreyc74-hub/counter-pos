import { toBase64 } from "./escpos";

export interface PrintPayload {
  bytes: Uint8Array;
  /** Same receipt as plain text lines, used by browser printing. */
  text: string;
  /** Which lines are big (double size), for browser printing. */
  bigLines: number[];
  /** Bold lines (-1) or bold leading characters (n), by line index, for browser printing. */
  boldLines?: Record<number, number>;
  /** Double-height lines, for browser printing. */
  tallLines?: number[];
  /** 1¼× lines, for browser printing. */
  mediumLines?: number[];
  widthChars: number;
}

export interface PrinterTransport {
  readonly kind: "bluetooth" | "rawbt" | "browser";
  /** True when a print can be attempted without a user tap. */
  isReady(): boolean;
  /** Name shown in settings, e.g. the Bluetooth device name. */
  deviceName(): string | null;
  /** interactive = called from a tap, so a chooser may be shown. */
  connect(interactive: boolean): Promise<void>;
  print(payload: PrintPayload): Promise<void>;
  disconnect(): Promise<void>;
}

// GATT services used by common Bluetooth Low Energy receipt printers. Web Bluetooth only
// lets us talk to services listed up front, so the list is deliberately broad.
const BLE_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prints straight from Chrome over Bluetooth Low Energy (Web Bluetooth).
 * Works only if the printer supports BLE. Classic-only printers need RawBT.
 */
export class WebBluetoothTransport implements PrinterTransport {
  readonly kind = "bluetooth" as const;
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  constructor(
    private readonly opts: { chunkSize: number; rememberedDeviceId: string | null; onDeviceId: (id: string) => void },
  ) {}

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator && typeof window !== "undefined" && window.isSecureContext;
  }

  isReady(): boolean {
    return !!this.characteristic && !!this.device?.gatt?.connected;
  }

  deviceName(): string | null {
    return this.device?.name ?? null;
  }

  async connect(interactive: boolean): Promise<void> {
    if (!WebBluetoothTransport.isSupported()) {
      throw new Error("This browser can't use Bluetooth. Use Chrome on Android over https, or choose RawBT.");
    }
    if (!this.device) this.device = await this.findRemembered();
    if (!this.device) {
      if (!interactive) throw new Error("Tap Connect printer to choose the printer.");
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_PRINTER_SERVICES,
      });
      this.opts.onDeviceId(this.device.id);
    }
    const device = this.device;
    if (!device.gatt) throw new Error("This device has no Bluetooth LE connection.");
    device.addEventListener("gattserverdisconnected", () => (this.characteristic = null), { once: true });
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    this.characteristic = await findWritable(server);
  }

  async print(payload: PrintPayload): Promise<void> {
    if (!this.isReady()) await this.connect(false);
    const ch = this.characteristic;
    if (!ch) throw new Error("Printer not connected.");
    const noResponse = ch.properties.writeWithoutResponse;
    const size = Math.max(20, this.opts.chunkSize);
    for (let i = 0; i < payload.bytes.length; i += size) {
      const chunk = payload.bytes.slice(i, i + size);
      if (noResponse) {
        await ch.writeValueWithoutResponse(chunk);
        await sleep(8); // give cheap printers time to drain their buffer
      } else {
        await ch.writeValueWithResponse(chunk);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
  }

  /** Reconnect without a chooser to a printer the browser already gave us permission for. */
  private async findRemembered(): Promise<BluetoothDevice | null> {
    const id = this.opts.rememberedDeviceId;
    const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
    if (!id || typeof bt.getDevices !== "function") return null;
    try {
      const devices = await bt.getDevices();
      return devices.find((d) => d.id === id) ?? null;
    } catch {
      return null;
    }
  }
}

async function findWritable(server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const s of services) {
    try {
      const chars = await s.getCharacteristics();
      const w = chars.find((c) => c.properties.writeWithoutResponse) ?? chars.find((c) => c.properties.write);
      if (w) return w;
    } catch {
      // some services refuse enumeration; try the next one
    }
  }
  throw new Error("Connected, but this printer has no writable Bluetooth LE channel. Try RawBT instead.");
}

/**
 * Hands the receipt bytes to the free RawBT Android app, which prints over classic
 * Bluetooth (SPP). Works with almost every cheap ESC/POS printer.
 */
export class RawBtTransport implements PrinterTransport {
  readonly kind = "rawbt" as const;
  isReady(): boolean {
    return true;
  }
  deviceName(): string | null {
    return "RawBT app";
  }
  async connect(): Promise<void> {}
  async print(payload: PrintPayload): Promise<void> {
    const url = `intent:base64,${toBase64(payload.bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    window.location.href = url;
  }
  async disconnect(): Promise<void> {}
}

/** Opens the browser's print dialog with a receipt-sized page (USB printers, testing). */
export class BrowserPrintTransport implements PrinterTransport {
  readonly kind = "browser" as const;
  isReady(): boolean {
    return true;
  }
  deviceName(): string | null {
    return "Browser print dialog";
  }
  async connect(): Promise<void> {}
  async print(payload: PrintPayload): Promise<void> {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Could not open the print view.");
    const mm = payload.widthChars >= 48 ? 80 : 58;
    const rows = payload.text
      .split("\n")
      .map((line, i) => {
        const b = payload.boldLines?.[i];
        const html =
          b == null ? escapeHtml(line) : b < 0 ? `<b>${escapeHtml(line)}</b>` : `<b>${escapeHtml(line.slice(0, b))}</b>${escapeHtml(line.slice(b))}`;
        if (payload.tallLines?.includes(i)) return `<div class="tall"><span>${html || "&nbsp;"}</span></div>`;
        if (payload.mediumLines?.includes(i)) return `<div class="medium"><b>${escapeHtml(line) || "&nbsp;"}</b></div>`;
        return `<div class="${payload.bigLines.includes(i) ? "big" : ""}">${html || "&nbsp;"}</div>`;
      })
      .join("");
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
      @page { size: ${mm}mm auto; margin: 0; }
      body { margin: 0; padding: 2mm; font: 12px/1.3 ui-monospace, Menlo, Consolas, monospace; white-space: pre; }
      .big { font-weight: 700; font-size: 24px; line-height: 1.2; }
      .medium { font-size: 15px; line-height: 1.3; }
      .tall { height: 2.9em; } .tall > span { display: inline-block; transform: scaleY(2); transform-origin: top left; }
    </style></head><body>${rows}</body></html>`);
    doc.close();
    await sleep(50);
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }
  async disconnect(): Promise<void> {}
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
