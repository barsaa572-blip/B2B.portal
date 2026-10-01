// Extract exact scanned PDF regions without redrawing or synthesizing artwork.
// Coordinates apply only to the company-provided September 2026 A4 scan.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, degrees } from 'pdf-lib';
if (!process.argv[2]) throw new Error('Provide the authorized source PDF path.');
const source = await PDFDocument.load(await readFile(process.argv[2]));
const out = new URL('../private/invoice/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [name, box] of Object.entries({
  stamp: { left:330, bottom:580, right:460, top:710 },
  signature: { left:372, bottom:320, right:448, top:445 }
})) {
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPage(source.getPage(0), box);
  const width = box.right-box.left, height = box.top-box.bottom;
  const page = pdf.addPage([height,width]);
  page.drawPage(embedded, { x:height, y:0, width, height, rotate:degrees(90) });
  await writeFile(new URL(`${name}.pdf`, out), await pdf.save());
}
