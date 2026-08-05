import { readFile, writeFile } from "node:fs/promises";

const target = process.argv[2];
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!target) {
  throw new Error("Debe indicar la ruta del archivo config.js.");
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl || "")) {
  throw new Error("La variable SUPABASE_URL no está definida o no es válida.");
}

if (!supabasePublishableKey || supabasePublishableKey.length < 20) {
  throw new Error("La variable SUPABASE_PUBLISHABLE_KEY no está definida o no es válida.");
}

const original = await readFile(target, "utf8");
const updated = original
  .replace(/supabaseUrl:\s*"[^"]+"/, `supabaseUrl: "${supabaseUrl}"`)
  .replace(/supabasePublishableKey:\s*"[^"]+"/, `supabasePublishableKey: "${supabasePublishableKey}"`);

if (!updated.includes(`supabaseUrl: "${supabaseUrl}"`)
    || !updated.includes(`supabasePublishableKey: "${supabasePublishableKey}"`)) {
  throw new Error("No fue posible insertar la configuración en config.js.");
}

await writeFile(target, updated, "utf8");
