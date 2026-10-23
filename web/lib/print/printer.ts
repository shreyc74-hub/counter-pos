import { uuid } from "@/lib/uuid";
import { encodeReceipt } from "./escpos";
import { type ReceiptLine, renderText } from "./receipt";
import {
  BrowserPrintTransport,
  type PrintPayload,
  type PrinterTransport,
  RawBtTransport,
  WebBluetoothTransport,
} from "./transports";

export type PrinterMode = "none" | "bluetooth" | "rawbt" | "browser";

export interface PrinterSettings {
  mode: PrinterMode;
  /** 32 characters for 58 mm paper, 48 for 80 mm. */
  width: 32 | 48;
  cut: boolean;
  autoPrint: boolean;
  /** Bluetooth LE write size. 20 is safe for every printer; larger is faster if it works. */
  chunkSize: number;
  bluetoothDeviceId: string | null;
}

export interface PrintJob {
  id: string;
  label: string;
  status: "queued" | "printing" | "done" | "failed";
  attempts: number;
  error: string | null;
  createdAt: number;
  lines: ReceiptLine[];
}

const SETTINGS_KEY = "cpos.printer.v1";
const DEFAULTS: PrinterSettings = {
  mode: "none",
  width: 32,
  cut: false,
  autoPrint: true,
  chunkSize: 20,
  bluetoothDeviceId: null,
};

type Listener = () => void;

/**
 * Owns the printer connection and a small print queue. A bill is always saved
 * before it reaches here; printing can fail and be retried without blocking billing.
 */
export class PrinterService {
  private settings: PrinterSettings;
  private transport: PrinterTransport | null = null;
  private jobs: PrintJob[] = [];
  private listeners = new Set<Listener>();
  private busy = false;
  private version = 0;

  constructor() {
    this.settings = loadSettings();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Changes whenever settings, connection or jobs change (for React). */
  getVersion(): number {
    return this.version;
  }

  getSettings(): PrinterSettings {
    return this.settings;
  }

  getJobs(): PrintJob[] {
    return this.jobs;
  }

  isConnected(): boolean {
    return this.settings.mode !== "none" && !!this.getTransport()?.isReady();
  }

  deviceName(): string | null {
    return this.getTransport()?.deviceName() ?? null;
  }

  updateSettings(patch: Partial<PrinterSettings>): void {
    const modeChanged = patch.mode !== undefined && patch.mode !== this.settings.mode;
    if (modeChanged) void this.transport?.disconnect();
    this.settings = { ...this.settings, ...patch };
    if (modeChanged || patch.chunkSize !== undefined) this.transport = null;
    saveSettings(this.settings);
    this.emit();
  }

  /** Must be called from a tap when using Bluetooth (the browser shows a chooser). */
  async connect(): Promise<void> {
    const t = this.getTransport();
    if (!t) throw new Error("Choose how to print first.");
    await t.connect(true);
    this.emit();
  }

  async forgetPrinter(): Promise<void> {
    await this.transport?.disconnect();
    this.transport = null;
    this.updateSettings({ bluetoothDeviceId: null });
  }

  /** Queue a receipt. Returns the job id. */
  enqueue(label: string, lines: ReceiptLine[]): string | null {
    if (this.settings.mode === "none") return null;
    const job: PrintJob = { id: uuid(), label, status: "queued", attempts: 0, error: null, createdAt: Date.now(), lines };
    this.jobs = [job, ...this.jobs].slice(0, 30);
    this.emit();
    void this.drain();
    return job.id;
  }

  retry(jobId: string): void {
    this.jobs = this.jobs.map((j) => (j.id === jobId ? { ...j, status: "queued", error: null } : j));
    this.emit();
    void this.drain();
  }

  dismiss(jobId: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== jobId);
    this.emit();
  }

  job(jobId: string | null): PrintJob | null {
    return jobId ? (this.jobs.find((j) => j.id === jobId) ?? null) : null;
  }

  buildPayload(lines: ReceiptLine[]): PrintPayload {
    const width = this.settings.width;
    const textLines: string[] = [];
    const bigLines: number[] = [];
    const boldLines: Record<number, number> = {};
    lines.forEach((l) => {
      if (l.kind === "text" && l.big) bigLines.push(textLines.length);
      if (l.kind === "text" && (l.bold || l.boldChars)) boldLines[textLines.length] = l.bold ? -1 : (l.boldChars ?? -1);
      textLines.push(renderText([l], width));
    });
    return {
      bytes: encodeReceipt(lines, { cut: this.settings.cut }, width),
      text: textLines.join("\n"),
      bigLines,
      boldLines,
      widthChars: width,
    };
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // oldest first
      for (;;) {
        const next = [...this.jobs].reverse().find((j) => j.status === "queued");
        if (!next) break;
        await this.run(next.id);
      }
    } finally {
      this.busy = false;
    }
  }

  private async run(jobId: string): Promise<void> {
    const patch = (p: Partial<PrintJob>) => {
      this.jobs = this.jobs.map((j) => (j.id === jobId ? { ...j, ...p } : j));
      this.emit();
    };
    const job = this.job(jobId);
    if (!job) return;
    const transport = this.getTransport();
    if (!transport) {
      patch({ status: "failed", error: "No printer set up." });
      return;
    }
    const payload = this.buildPayload(job.lines);
    const delays = transport.kind === "bluetooth" ? [0, 600, 1500] : [0];
    let lastError = "";
    for (const delay of delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      patch({ status: "printing", attempts: (this.job(jobId)?.attempts ?? 0) + 1 });
      try {
        await transport.print(payload);
        patch({ status: "done", error: null });
        return;
      } catch (e) {
        lastError = friendlyError(e);
      }
    }
    patch({ status: "failed", error: lastError });
  }

  private getTransport(): PrinterTransport | null {
    if (this.transport) return this.transport;
    const s = this.settings;
    if (s.mode === "bluetooth") {
      this.transport = new WebBluetoothTransport({
        chunkSize: s.chunkSize,
        rememberedDeviceId: s.bluetoothDeviceId,
        onDeviceId: (id) => this.updateSettings({ bluetoothDeviceId: id }),
      });
    } else if (s.mode === "rawbt") this.transport = new RawBtTransport();
    else if (s.mode === "browser") this.transport = new BrowserPrintTransport();
    return this.transport;
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User cancelled|chooser/i.test(msg)) return "No printer chosen.";
  if (/GATT|disconnected|NetworkError/i.test(msg)) return "Printer is off or out of range. Turn it on and tap Retry.";
  return msg;
}

function loadSettings(): PrinterSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(SETTINGS_KEY) : null;
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PrinterSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: PrinterSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // settings stay in memory for this session
  }
}

let shared: PrinterService | null = null;
export function printer(): PrinterService {
  return (shared ??= new PrinterService());
}
