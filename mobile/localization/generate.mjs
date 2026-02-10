import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "mobile/localization");
const locales = ["en", "fr"];

const escapeIos = (value) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\"/g, "\\\"");

const escapeAndroid = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");

const toAndroidKey = (key) => key.replace(/\./g, "_");

const writeIos = async (locale, entries) => {
  const lines = Object.keys(entries)
    .sort()
    .map((key) => `"${key}" = "${escapeIos(entries[key])}";`);
  const content = `${lines.join("\n")}\n`;
  const outPath = path.resolve(
    process.cwd(),
    "mobile/iosApp/iosApp/Resources",
    `${locale}.lproj/Localizable.strings`
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, content, "utf8");
};

const writeAndroid = async (locale, entries) => {
  const lines = Object.keys(entries)
    .sort()
    .map((key) => {
      const androidKey = toAndroidKey(key);
      return `    <string name=\"${androidKey}\">${escapeAndroid(entries[key])}</string>`;
    });
  const content = `<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n${lines.join(
    "\n"
  )}\n</resources>\n`;

  const baseDir = path.resolve(
    process.cwd(),
    "mobile/androidApp/src/main/res",
    locale === "en" ? "values-en" : "values"
  );
  const outPath = path.join(baseDir, "strings.xml");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(outPath, content, "utf8");
};

const run = async () => {
  for (const locale of locales) {
    const filePath = path.join(root, `strings.${locale}.json`);
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    await writeIos(locale, data);
    await writeAndroid(locale, data);
  }
};

await run();
