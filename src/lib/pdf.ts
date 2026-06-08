import { jsPDF } from "jspdf";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AttrStatus, DiskInfo, SmartReport } from "../types";
import { formatBytes } from "./format";
import {
  attributeView,
  nvmeViews,
  healthSummary,
  humanHours,
  statusLabel,
} from "./smartMeta";

type RGB = [number, number, number];

const CLAY: RGB = [217, 119, 87];
const INK: RGB = [40, 38, 34];
const MUTED: RGB = [120, 114, 104];
const FAINT: RGB = [150, 144, 134];
const LINE: RGB = [223, 217, 208];
const ZEBRA: RGB = [248, 246, 242];

const OK: RGB = [110, 150, 96];
const WARN: RGB = [196, 146, 52];
const BAD: RGB = [202, 92, 78];

function statusColor(s: AttrStatus): RGB {
  return s === "bad" ? BAD : s === "warn" ? WARN : OK;
}

function healthTone(report: SmartReport): { color: RGB; tint: RGB; label: string } {
  switch (report.overall) {
    case "good":
      return { color: OK, tint: [238, 244, 234], label: "HEALTHY" };
    case "caution":
      return { color: WARN, tint: [249, 243, 230], label: "CAUTION" };
    case "bad":
      return { color: BAD, tint: [250, 236, 233], label: "AT RISK" };
    default:
      return { color: MUTED, tint: [241, 239, 235], label: "UNKNOWN" };
  }
}

/** Render a SMART report into a PDF document and return its bytes. */
export function buildSmartPdf(disk: DiskInfo, report: SmartReport): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 56;
  let y = 0;

  const ensure = (space: number) => {
    if (y + space > bottom) {
      doc.addPage();
      y = margin;
    }
  };

  // ---- Header band ----------------------------------------------------------
  const headerH = 76;
  doc.setFillColor(...CLAY);
  doc.rect(0, 0, pageW, headerH, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("DiskWipe.IO", margin, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(252, 240, 234);
  doc.text("S.M.A.R.T. Health Report", margin, 54);

  doc.setFontSize(9);
  doc.text(new Date().toLocaleString(), pageW - margin, 36, { align: "right" });
  doc.text(
    report.model || disk.model || "Unknown drive",
    pageW - margin,
    54,
    { align: "right" }
  );

  y = headerH + 28;

  // ---- Health summary card --------------------------------------------------
  const tone = healthTone(report);
  const summary = healthSummary(report);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const msgLines = doc.splitTextToSize(summary.message, contentW - 44) as string[];
  const cardH = 50 + msgLines.length * 14;

  doc.setFillColor(...tone.tint);
  doc.setDrawColor(...tone.color);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, contentW, cardH, 8, 8, "FD");
  doc.setFillColor(...tone.color);
  doc.roundedRect(margin, y, 5, cardH, 2, 2, "F");

  let cy = y + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(summary.title, margin + 18, cy);

  // status pill on the right
  const pillW = 78;
  doc.setFillColor(...tone.color);
  doc.roundedRect(pageW - margin - pillW - 6, cy - 13, pillW, 19, 9, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(tone.label, pageW - margin - pillW - 6 + pillW / 2, cy, {
    align: "center",
  });

  cy += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  for (const ln of msgLines) {
    doc.text(ln, margin + 18, cy);
    cy += 14;
  }
  cy += 2;
  doc.setFontSize(9);
  doc.setTextColor(...FAINT);
  const counts = [
    `${summary.okCount} OK`,
    summary.warnCount > 0 ? `${summary.warnCount} watch` : "",
    summary.badCount > 0 ? `${summary.badCount} critical` : "",
  ]
    .filter(Boolean)
    .join("   ·   ");
  doc.text(counts, margin + 18, cy);

  y += cardH + 26;

  // ---- Device summary -------------------------------------------------------
  sectionHeading(doc, "Device", margin, y, contentW);
  y += 20;

  const facts: [string, string][] = [
    ["Model", report.model || disk.model || "—"],
    ["Serial", report.serial || disk.serial || "—"],
    ["Firmware", report.firmware || "—"],
    ["Device", report.device || disk.path],
    ["Protocol", report.protocol || "—"],
    ["Capacity", formatBytes(report.capacityBytes || disk.sizeBytes)],
    [
      "Temperature",
      report.temperatureC != null ? `${report.temperatureC} °C` : "—",
    ],
    [
      "Power-On Hours",
      report.powerOnHours != null
        ? `${report.powerOnHours.toLocaleString("en-US")} h  (≈ ${humanHours(
            report.powerOnHours
          )})`
        : "—",
    ],
    [
      "Power Cycles",
      report.powerCycles != null
        ? report.powerCycles.toLocaleString("en-US")
        : "—",
    ],
  ];

  const colW = contentW / 2;
  const rowH = 18;
  doc.setFontSize(10);
  facts.forEach(([k, v], i) => {
    const col = i % 2;
    const rowInPair = Math.floor(i / 2);
    const rx = margin + col * colW;
    const ry = y + rowInPair * rowH;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...FAINT);
    doc.text(k, rx, ry);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(String(v), rx + 86, ry, { maxWidth: colW - 96 });
  });
  y += Math.ceil(facts.length / 2) * rowH + 18;

  // ---- S.M.A.R.T. attributes ------------------------------------------------
  if (report.attributes.length > 0) {
    ensure(60);
    sectionHeading(doc, "S.M.A.R.T. Attributes", margin, y, contentW);
    y += 18;

    const cId = margin + 8;
    const cName = margin + 44;
    const cRaw = margin + 300;
    const cNorm = margin + 396;
    const cStat = pageW - margin - 8;

    const drawAttrHeader = () => {
      doc.setFillColor(...INK);
      doc.rect(margin, y, contentW, 20, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(236, 233, 227);
      doc.text("ID", cId, y + 13);
      doc.text("ATTRIBUTE", cName, y + 13);
      doc.text("READING", cRaw, y + 13);
      doc.text("VAL/THR", cNorm, y + 13);
      doc.text("STATUS", cStat, y + 13, { align: "right" });
      y += 20;
    };
    drawAttrHeader();

    const rows = report.attributes.map(attributeView);
    doc.setFontSize(9);
    rows.forEach((a, i) => {
      if (y + 18 > bottom) {
        doc.addPage();
        y = margin;
        drawAttrHeader();
      }
      const rh = 18;
      if (i % 2 === 1) {
        doc.setFillColor(...ZEBRA);
        doc.rect(margin, y, contentW, rh, "F");
      }
      const ty = y + 12;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...FAINT);
      doc.text(String(a.id), cId, ty);
      doc.setTextColor(...INK);
      doc.text(clip(doc, a.label, cRaw - cName - 8), cName, ty);
      doc.setFont("helvetica", "bold");
      doc.text(clip(doc, a.raw, cNorm - cRaw - 8), cRaw, ty);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...FAINT);
      doc.text(`${a.value}/${a.threshold}`, cNorm, ty);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...statusColor(a.status));
      doc.text(statusLabel(a.status).toUpperCase(), cStat, ty, {
        align: "right",
      });
      y += rh;
    });
    y += 16;
  }

  // ---- NVMe health log ------------------------------------------------------
  if (report.nvme && Object.keys(report.nvme).length > 0) {
    const views = nvmeViews(report.nvme);
    ensure(60);
    sectionHeading(doc, "NVMe Health Log", margin, y, contentW);
    y += 18;

    const drawNvmeHeader = () => {
      doc.setFillColor(...INK);
      doc.rect(margin, y, contentW, 20, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(236, 233, 227);
      doc.text("METRIC", margin + 8, y + 13);
      doc.text("VALUE", pageW - margin - 8, y + 13, { align: "right" });
      y += 20;
    };
    drawNvmeHeader();

    views.forEach((r, i) => {
      if (y + 26 > bottom) {
        doc.addPage();
        y = margin;
        drawNvmeHeader();
      }
      const rh = 26;
      if (i % 2 === 1) {
        doc.setFillColor(...ZEBRA);
        doc.rect(margin, y, contentW, rh, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(r.label, margin + 8, y + 11);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...FAINT);
      doc.text(clip(doc, r.description, contentW - 130), margin + 8, y + 21);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...statusColor(r.status));
      doc.text(r.display, pageW - margin - 8, y + 14, { align: "right" });
      y += rh;
    });
    y += 12;
  }

  // ---- Footer ---------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 40, pageW - margin, pageH - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(
      "Generated by DiskWipe.IO — github.com/DenisHumen/DiskWipe.IO",
      margin,
      pageH - 26
    );
    doc.text(`Page ${i} / ${pages}`, pageW - margin, pageH - 26, {
      align: "right",
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

function sectionHeading(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...CLAY);
  doc.text(text.toUpperCase(), x, y);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(x, y + 6, x + width, y + 6);
}

/** Truncate a string with an ellipsis so it fits within maxWidth points. */
function clip(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(s + "…") > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

/** Build the PDF and prompt the user for a save location. Returns the path or null. */
export async function saveSmartPdf(
  disk: DiskInfo,
  report: SmartReport
): Promise<string | null> {
  const bytes = buildSmartPdf(disk, report);
  const safe = (report.serial || report.model || "disk")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .slice(0, 40);
  const path = await save({
    title: "Save SMART report",
    defaultPath: `SMART_${safe}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await invoke("save_file", { path, contents: Array.from(bytes) });
  return path;
}
