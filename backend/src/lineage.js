import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const LINEAGE_FILE = path.join(DATA_DIR, "etl-lineage.jsonl");

export function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

/**
 * Спрощене Open Lineage: запис JSON Lines для кожного успішного прогону ETL+NLP.
 */
export function appendLineageRecord(record) {
  ensureDataDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n";
  fs.appendFileSync(LINEAGE_FILE, line, "utf8");
}
